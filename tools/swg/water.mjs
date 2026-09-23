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
// with kind 'lava' so the game can tell them from water even where the terrain's water type says 0,
// and each carries a `lava` block: the MATL's flow and colour values, the bloom texture factor, the
// colour ramp inline, and the crust and the noise volume written under <pack>/water/.
//
// Beside them the pack carries a `harm` block: what the client's own two little terrain tables say
// being in each kind of water does to you, and which templates it says take none of it. Every number
// in that block is the client's, marked so; what the game actually applies is its own, live, and
// nowhere near here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseDatatable } from './datatable.mjs';
import { findAll, parseIff } from './iff.mjs';
import { shaderTextures } from './sht.mjs';
import { decodeDds, decodeDdsVolume, isDdsCube } from './dds.mjs';
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
const round6 = (v) => Math.round(v * 1e6) / 1e6;

/**
 * A lava shader's MATL chunk (17 float32 LE, four ARGB groups and a power): the third group is the
 * emissive one, loopTime then the flow's r, g, b; the fourth the specular one, a, colorScale,
 * colorBias, tcScale. Null when shorter than 64 bytes or any value read is not finite. Every retail
 * flow × loopTime is a whole number, which is why a tiling texture loops without a seam.
 */
export function lavaParams(matlData) {
  if (!matlData || matlData.length < 64) return null;
  const f = (i) => matlData.readFloatLE(i * 4);
  const values = [f(8), f(9), f(10), f(11), f(13), f(14), f(15)];
  if (!values.every(Number.isFinite)) return null;
  const [loopTime, fr, fg, fb, colorScale, colorBias, tcScale] = values.map(round6);
  return { loopTime, flow: [fr, fg, fb], colorScale, colorBias, tcScale };
}

/**
 * The shader's bloom texture factor, 0..1, or null without one: the TFNS entry tagged BLUM (stored
 * reversed, `MULB`, as sht.mjs's slotTag reads TXM tags), the red channel of its little-endian ARGB
 * value. The entries are 8 bytes each: the tag, then the value.
 */
export function textureFactorOf(root) {
  const data = findAll(root, 'TFNS')[0]?.children?.[0]?.data;
  if (!data) return null;
  for (let o = 0; o + 8 <= data.length; o += 8) {
    const tag = Buffer.from(data.subarray(o, o + 4)).reverse().toString('latin1');
    if (tag !== 'BLUM') continue;
    return ((data.readUInt32LE(o + 4) >>> 16) & 255) / 255;
  }
  return null;
}

/**
 * The `lava` block of a lava shader's water.json entry. The ramp (LKUP) goes inline, top row only, as
 * { width, rgba: base64 }, because a PNG's alpha travels through the browser's image decoder, which may
 * drop colour under low alpha, and the ramp's alpha is the glow. The crust (TEXT) is written as
 * water/<stem>.png at its own size with alpha forced to 255; the noise volume (NOIS) as
 * water/<stem>.r8, its bytes as they are, with its size. Each output file is written once per planet:
 * `written` (the per-planet cache the cubes use) is keyed by the pack path. A slot that names a file
 * that is missing or fails to decode is null, with a note naming the file; a MATL that cannot be read
 * makes the whole block null.
 */
export function lavaEntry(vfs, root, slots, outDir, written, notes, writeFile = writeFileSync) {
  const params = lavaParams(findAll(root, 'MATL')[0]?.data);
  if (!params) return null;
  const slot = (tag) => {
    const s = slots.find((x) => x.slot === tag);
    return s && s.path ? clean(s.path) : null;
  };
  const read = (p, what, decode) => {
    if (!vfs.has(p)) {
      notes.push(`${p}: the lava ${what} is not in the archives`);
      return null;
    }
    try {
      return decode(vfs.read(p));
    } catch (err) {
      notes.push(`${p}: ${err.message}`);
      return null;
    }
  };
  const stem = (p) => basename(p).replace(/\.dds$/i, '');
  /**
   * Writes a pack file once per planet. `make` returns { bytes, value } or null; the cached result is
   * that value, or null when it failed, so a second shader naming the file neither writes nor notes it
   * again. The folder is made here, where the file is about to be written, never through `writeFile`.
   */
  const once = (rel, make) => {
    if (written.has(rel)) return written.get(rel);
    let result = null;
    const made = make();
    if (made) {
      mkdirSync(join(outDir, 'water'), { recursive: true });
      writeFile(join(outDir, rel), made.bytes);
      result = made.value;
    }
    written.set(rel, result);
    return result;
  };

  let ramp = null;
  const rampPath = slot('LKUP');
  if (rampPath) {
    const img = read(rampPath, 'colour ramp', decodeDds);
    if (img && img.width > 0) ramp = { width: img.width, rgba: Buffer.from(img.rgba.subarray(0, img.width * 4)).toString('base64') };
  }

  let mix = null;
  const mixPath = slot('TEXT');
  if (mixPath) {
    const rel = `water/${stem(mixPath)}.png`;
    mix = once(rel, () => {
      const img = read(mixPath, 'crust', decodeDds);
      if (!img) return null;
      for (let i = 3; i < img.rgba.length; i += 4) img.rgba[i] = 255;
      return { bytes: encodePng(img.width, img.height, img.rgba), value: rel };
    });
  }

  let noise = null;
  const noisePath = slot('NOIS');
  if (noisePath) {
    const rel = `water/${stem(noisePath)}.r8`;
    noise = once(rel, () => {
      const vol = read(noisePath, 'noise volume', decodeDdsVolume);
      if (!vol) return null;
      return { bytes: vol.data, value: { file: rel, size: [vol.width, vol.height, vol.depth] } };
    });
  }

  const factor = textureFactorOf(root);
  return { ...params, textureFactor: factor === null ? null : Math.round(factor * 1e4) / 1e4, ramp, mix, noise };
}

/**
 * One water shader's entry for water.json, with its cube's faces written under <outDir>/water/.
 * `use` is a waterShaderUses() row ({ shader, waterTypes, tables, global }); `written` carries the
 * cubes already written for this planet so two shaders naming one cube write it once; `notes`
 * collects anything that could not be read. `writeFile` is the writer (injected by the tests).
 *
 * A lava entry has no colour and no cube. One whose effect is a lava effect gets its `lava` block
 * (lavaEntry) and stops there; a type-1 table wearing a plain water shader is still lava but gets no
 * block, and the game draws it in its stand-in lava look.
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
  if (kind === 'lava') {
    if (isLavaEffect(effect)) {
      entry.lava = lavaEntry(vfs, root, slots, outDir, written, notes, writeFile);
      if (!entry.lava) notes.push(`${path}: its MATL cannot be read, so it has no lava look`);
    }
    return entry;
  }

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

/** The client's own table of what being in each kind of water does to you. */
export const WATER_VALUES = 'datatables/terrain/water_values.iff';
/** The client's own list of templates that take no damage from it. */
export const CREATURE_WATER_VALUES = 'datatables/terrain/creature_water_values.iff';

/**
 * water_values.iff as rows: one per kind of water, in the order the table holds them. The terrain's
 * own water tables carry a water type as a number and this table has no such column, so the row's
 * index is taken as that number — an inference, not something the archives state. Each row keeps its
 * own `water_type` name beside the index so a reader can check the two agree rather than trust it.
 *
 * `percent` is the table's own column untouched; `share` is the same number as a fraction, written
 * once here so no reader has to remember to divide. Whether that share is of maximum or of current
 * health the table does not say, and the game decides. The field names are the ones the game's own
 * reader takes (`damage`, `kills`, `interval`/`intervalSeconds`, `share`/`percent`): rename one here
 * and it must be renamed there in the same breath, or a row reads as doing no damage at all.
 */
export function waterHarmTypes(table) {
  return (table?.rows ?? []).map((row, type) => {
    const percent = Number(row.damage_per_interval_percentage ?? 0);
    const ok = Number.isFinite(percent);
    const interval = Number(row.damage_interval_secs ?? 0);
    return {
      type,
      name: String(row.water_type ?? ''),
      damage: !!row.causes_damage,
      kills: !!row.damage_kills,
      intervalSeconds: Number.isFinite(interval) ? round6(interval) : 0,
      percent: ok ? round6(percent) : 0,
      share: ok ? round6(percent / 100) : 0,
      transparent: !!row.transparent,
    };
  });
}

/**
 * creature_water_values.iff as rows: the templates the client says take no damage from lava, each
 * with the resistance it gives them (every retail row is 100).
 *
 * The table names the server template, which is not in the client archives at all; what is there,
 * and what every pack is keyed on, is the shared template beside it — the same path with `shared_`
 * in front of the file's own name. So each row is resolved that way and reduced to the file's stem
 * (`id`), which is the name a converted vehicle or creature carries. `has(path)` answers whether a
 * path is in the archives; a row whose sibling is not there keeps `shared` null and is reported as a
 * miss rather than dropped, since its id may still join to something a pack holds.
 */
export function waterImmunity(table, has = () => false) {
  return (table?.rows ?? []).map((row) => {
    const template = clean(row.object_template_name);
    const cut = template.lastIndexOf('/');
    const shared = `${template.slice(0, cut + 1)}shared_${template.slice(cut + 1)}`;
    const resistance = Number(row.lava_resistance ?? 0);
    return {
      template,
      shared: has(shared) ? shared : null,
      id: template.slice(cut + 1).replace(/\.iff$/, ''),
      resistance: Number.isFinite(resistance) ? round6(resistance) : 0,
    };
  });
}

/**
 * The `harm` block for water.json: both of the client's tables, read straight. Null when neither is
 * in the archives or neither will parse, with why in `notes`; a table that is missing on its own
 * leaves its own list empty. Nothing here is ours: `source` says so, and the two file names say
 * where each list came from.
 */
export function readWaterHarm(vfs, notes = []) {
  const read = (path) => {
    if (!vfs.has(path)) {
      notes.push(`${path}: not in the archives, so the pack carries none of its values`);
      return null;
    }
    try {
      return parseDatatable(parseIff(vfs.read(path)));
    } catch (err) {
      notes.push(`${path}: ${err.message}`);
      return null;
    }
  };
  const values = read(WATER_VALUES);
  const creatures = read(CREATURE_WATER_VALUES);
  if (!values && !creatures) return null;
  return {
    source: 'client',
    files: { types: WATER_VALUES, immune: CREATURE_WATER_VALUES },
    typeFrom: 'row',
    types: waterHarmTypes(values),
    immune: waterImmunity(creatures, (p) => vfs.has(p)),
  };
}

/**
 * What the run says it read: a line per table, then which immunity rows joined to a shared template
 * and which did not. Printed once a run, not once a planet, since both tables are the whole game's.
 */
export function waterHarmLines(harm) {
  if (!harm) return ["lava harm: neither of the client's water value tables could be read"];
  const say = (t) => `${t.name || `type ${t.type}`} ${t.damage ? `${t.percent}% every ${t.intervalSeconds}s${t.kills ? ', kills' : ''}` : 'unharmed'}`;
  const joined = harm.immune.filter((e) => e.shared);
  const lines = [
    `lava harm: ${harm.files.types}, ${harm.types.length} rows (${harm.types.map(say).join('; ')}); the row index is read as the terrain's own water type`,
    `lava harm: ${harm.files.immune}, ${harm.immune.length} rows, ${joined.length} joined to a shared template, ${harm.immune.length - joined.length} not`,
  ];
  if (joined.length) lines.push(`  joined: ${joined.map((e) => e.id).join(', ')}`);
  for (const e of harm.immune) if (!e.shared) lines.push(`  ${e.template}: no shared template in the archives`);
  return lines;
}

/**
 * Whether `status` should ask for the water command again: the pack has lava in it and no harm
 * block, which is a pack converted before the client's water values were read. A pack with no lava
 * at all is never asked, and neither is one whose block is already there.
 */
export function waterPackNeedsHarm(water) {
  if (!water || typeof water !== 'object') return false;
  if (water.harm) return false;
  return Object.values(water.shaders ?? {}).some((s) => s && s.kind === 'lava');
}

/**
 * Write <outDir>/water.json for a terrain's water shader uses and return 'water.json'. Always
 * writes, with `shaders: {}` when the terrain has no water at all, so `status` only has to see
 * that the file is there. `template` is the template parsed for this planet, never another's.
 *
 * `harm` is the client's water values, read once a run by the caller and handed to every planet;
 * left out, this reads them itself, so a planet converted through the snapshot carries them too.
 */
export function exportWater(vfs, planet, uses, template, outDir, { log = console.error, writeFile = writeFileSync, harm } = {}) {
  const notes = [];
  const written = new Map();
  const shaders = {};
  mkdirSync(outDir, { recursive: true });
  for (const use of uses) shaders[use.shader] = waterShaderEntry(vfs, use, outDir, written, notes, writeFile);
  const global = template?.useGlobalWaterTable
    ? { height: template.globalWaterTableHeight, shader: uses.find((u) => u.global)?.shader ?? '', shaderSize: template.globalWaterTableShaderSize }
    : null;
  const values = harm === undefined ? readWaterHarm(vfs, notes) : harm;
  if (!values) notes.push("the client's water value tables could not be read, so this pack carries no harm block");
  const out = { version: 1, planet, global, harm: values ?? null, shaders, notes };
  writeFile(join(outDir, 'water.json'), JSON.stringify(out, null, 1));
  const list = Object.values(shaders);
  const lava = list.filter((s) => s.kind === 'lava').length;
  // `written` holds the cubes by archive path and the lava files by their pack path under water/.
  const cubes = [...written.values()].filter((v) => v && Array.isArray(v.faces)).length;
  const lavaFiles = [...written.entries()].filter(([k, v]) => v && k.startsWith('water/')).length;
  log(`  water: ${list.length} shaders (${list.length - lava} water, ${lava} lava), ${cubes} cubes${lava ? `, lava files ${lavaFiles}` : ''} -> water.json`);
  for (const n of notes) log(`    ${n}`);
  return 'water.json';
}
