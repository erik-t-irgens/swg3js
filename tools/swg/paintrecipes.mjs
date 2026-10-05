// A pack's paint recipes: one per paint shader -- a customizable shader whose colours a player may change
// (shipfit.mjs `isPaintShader`) -- written into the pack's customize.json with its images under the pack's
// customize/, and each shader's variables kept for the pack's own merge (`variablesOf`). The ships command
// has always made its recipes this way; the gallery's vehicles make theirs through the same function, so a
// speeder's paint shader becomes a recipe exactly as a ship's does and the game's ShipPaint takes either.
//
// What the cli keeps to itself is handed in: the loader state the paint shaders read through (`ctx`, the
// cli's `paintContext`), whether a file is a customizable shader at all (`isCustomizable`, from its top form
// alone), and how a paint shader glows (`glowOf`, null for one that does not: the converted material's own
// glow, since a repaint's glow goes on the material's own emissive map and a material without one would need
// a new program).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isForm, parseIff, readCString } from './iff.mjs';
import { ImageRegistry, exportPalettes, exportShader, palettesOf } from './customize.mjs';
import { loadImage, loadShader, parsePalette } from './texrender.mjs';
import { isPaintShader, mergePaintVariables, recipeImages, trimPaintShader } from './shipfit.mjs';

/**
 * The recipe maker for one pack folder (`outDir`): `isPaint(shaderPath)` says whether a shader is paint and,
 * the first time one is, writes its recipe (the shader trimmed to the textures its passes read and a glow's
 * mask, every pattern and palette its variables choose from, the static MAIN, and how it glows);
 * `variablesOf(shaders)` is one variable list for the shaders a hull wears (`mergePaintVariables`, with each
 * palette's own size); `write(list)` writes customize.json for a list of recipes. `match` is a `--match` run:
 * its images are numbered past every one the old customize.json names, so none of theirs is overwritten.
 *  -> { isPaint, variablesOf, recipes (by shader path), stats: { images, bytes }, write, sweep }
 */
export function paintRecipeMaker(vfs, outDir, { ctx, isCustomizable, glowOf = () => null, match = false, log = (m) => console.error(m) }) {
  const recipes = new Map();
  const answered = new Map();
  // Each paint shader's variables, kept from its first load: the loader state is emptied after every hull, so
  // the images the bakes decoded are not held for the whole run.
  const variables = new Map();
  const customizeDir = join(outDir, 'customize');
  const stats = { images: 0, bytes: 0 };
  let registry = null;
  const NO_IMAGE = {};
  /** An image for the recipes' registry: read afresh (never kept), or nothing when the registry has written it already. */
  const imageLoad = (file) => (registry?.ids.has(file.toLowerCase()) ? NO_IMAGE : loadImage(vfs, file, new Map()));
  const registryFor = () => {
    if (registry) return registry;
    mkdirSync(customizeDir, { recursive: true });
    registry = new ImageRegistry((file, bytes) => {
      writeFileSync(join(customizeDir, file), bytes);
      stats.images++;
      stats.bytes += bytes.length;
    });
    // A --match run adds to the recipes already there: its images are numbered past every one those
    // name, so none of theirs is overwritten.
    if (match) {
      let highest = -1;
      try {
        const old = JSON.parse(readFileSync(join(outDir, 'customize.json'), 'utf8'));
        for (const f of recipeImages(old.recipes)) highest = Math.max(highest, Number(/_(\d+)\.png$/.exec(f)?.[1] ?? -1));
      } catch {
        /* no recipes yet */
      }
      for (let i = 0; i <= highest; i++) registry.ids.set(`\0kept:${i}`, null);
    }
    return registry;
  };
  /** The static shader's own MAIN under a customizable one: the look before customization, kept for the game to show on request. */
  const staticMainOf = (shaderPath) => {
    try {
      const v = parseIff(vfs.read(shaderPath.replace(/\\/g, '/'))).children.find(isForm);
      const base = v?.children.find((c) => (isForm(c) ? c.type === 'SSHT' : c.tag === 'NAME'));
      if (!base) return null;
      return loadShader(vfs, isForm(base) ? base : readCString(base.data).value.replace(/\\/g, '/'), ctx)?.textureFiles.get('MAIN') ?? null;
    } catch {
      return null;
    }
  };
  /**
   * Whether a model's shader is paint; the first time one is, its recipe. A shader whose recipe cannot be
   * written is not counted as paint.
   */
  const isPaint = (shaderPath) => {
    if (answered.has(shaderPath)) return answered.get(shaderPath);
    let yes = false;
    try {
      const loaded = isCustomizable(shaderPath) ? loadShader(vfs, shaderPath, ctx) : null;
      if (isPaintShader(loaded)) {
        const glow = glowOf(shaderPath);
        const t = trimPaintShader(loaded, { staticMain: staticMainOf(shaderPath), keep: glow ? [glow.maskTag] : [] });
        const reg = registryFor();
        recipes.set(shaderPath, { mesh: 'ship', material: shaderPath, kind: 'bake', baseTag: 'MAIN', shader: exportShader(t.shader, reg, imageLoad), slots: [], staticMain: t.staticMain ? reg.idFor(t.staticMain, imageLoad(t.staticMain)) : null, ...(glow ? { glow } : {}) });
        variables.set(shaderPath, loaded.variables);
        yes = true;
      }
    } catch (err) {
      log(`  paint recipe for ${shaderPath} not written: ${err.message}`);
    }
    answered.set(shaderPath, yes);
    return yes;
  };
  const paletteSizes = new Map();
  const paletteSize = (p) => {
    if (!paletteSizes.has(p)) {
      let n = 0;
      try {
        n = vfs.has(p) ? parsePalette(vfs.read(p)).length : 0;
      } catch {
        n = 0;
      }
      paletteSizes.set(p, n);
    }
    return paletteSizes.get(p);
  };
  /** One variable list for the paint shaders a hull wears: `{ variables, notes }` (mergePaintVariables). */
  const variablesOf = (shaders) => mergePaintVariables(shaders.map((p) => ({ path: p, variables: variables.get(p) ?? [] })), paletteSize);
  /** customize.json for a list of recipes, with every palette they read. */
  const write = (list) => writeFileSync(join(outDir, 'customize.json'), JSON.stringify({ images: 'customize/', recipes: list, palettes: exportPalettes(vfs, list.flatMap((r) => palettesOf(r))) }, null, 1));
  /**
   * Take out of customize/ every image this run's recipes do not name, and say how many: the registry numbers
   * its files in the order it meets them, so a run that meets one image more early on renames every file after
   * it, and an earlier run's copies would stay on disk unread. Never for a `--match` run, which keeps the other
   * recipes' images.
   */
  const sweep = () => {
    if (match || !existsSync(customizeDir)) return 0;
    const named = new Set(registry ? registry.ids.values() : []);
    let stale = 0;
    for (const f of readdirSync(customizeDir)) {
      if (!f.endsWith('.png') || named.has(f)) continue;
      rmSync(join(customizeDir, f), { force: true });
      stale++;
    }
    return stale;
  };
  return { isPaint, variablesOf, recipes, stats, write, sweep };
}
