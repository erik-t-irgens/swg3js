// Live customization: what the game needs to render a character's skin, hair and eyes itself,
// with other colours and choices than the pack was baked with. The converter's texture renderer
// (texrender.mjs) bakes at conversion time from the game's blueprints, shaders, effects, textures
// and palettes; this writes those same inputs into the pack in a browser-friendly form (JSON
// recipes and PNG images), and the game's port of the renderer (src/player/texrender.ts) runs
// them again whenever a slider or a swatch moves.
import { basename } from 'node:path';
import { encodePng } from './png.mjs';
import { loadShader, parsePalette } from './texrender.mjs';

/** Writes every image once, as a PNG named by its game path, and hands back its file name. */
export class ImageRegistry {
  constructor(write) {
    this.write = write;
    this.ids = new Map();
  }

  /** The file for a game texture path already decoded to RGBA; null when the image is missing. */
  idFor(path, img) {
    if (!img) return null;
    const key = path.toLowerCase();
    if (this.ids.has(key)) return this.ids.get(key);
    const id = `${basename(path).replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '_')}_${this.ids.size}.png`;
    this.write(id, encodePng(img.width, img.height, img.rgba));
    this.ids.set(key, id);
    return id;
  }
}

/** A shader's fixed-function passes, as data. */
function exportPasses(effect) {
  if (!effect) return null;
  return effect.passes.map((p) => ({
    alphaBlend: p.alphaBlend,
    blendOp: p.blendOp,
    blendSrc: p.blendSrc,
    blendDst: p.blendDst,
    alphaTest: p.alphaTest,
    alphaRefTag: p.alphaRefTag,
    alphaFunc: p.alphaFunc,
    writeMask: p.writeMask,
    tfactorTag: p.tfactorTag,
    stages: p.stageList.map((st) => ({
      colorOp: st.colorOp,
      colorArgs: st.colorArgs.map((a) => [a.arg, a.complement ? 1 : 0, a.alphaReplicate ? 1 : 0]),
      alphaOp: st.alphaOp,
      alphaArgs: st.alphaArgs.map((a) => [a.arg, a.complement ? 1 : 0, 0]),
      result: st.result,
      textureTag: st.textureTag,
      coordSetTag: st.coordSetTag,
      ...(st.addressU !== undefined ? { address: [st.addressU, st.addressV] } : {}),
    })),
  }));
}

/**
 * A shader as the game can rebuild it: its passes, its bound textures (as image files), its
 * factors and, for a customizable one, the texture choices and palette factors its variables set.
 */
export function exportShader(shader, registry, load) {
  if (!shader) return null;
  const textures = {};
  for (const [tag, file] of shader.textureFiles) {
    const id = registry.idFor(file, shader.textures.get(tag) ?? load(file));
    if (id) textures[tag] = id;
  }
  // Every texture a choice can pick, not only the one the pack was baked with.
  const choices = (shader.textureChoices ?? []).map((c) => ({ tag: c.tag, variable: c.variable, private: c.private, default: c.default, files: c.files.map((f) => registry.idFor(f, load(f))) }));
  return {
    effect: shader.effectFile,
    passes: exportPasses(shader.effect),
    textures,
    addresses: Object.fromEntries(shader.addresses),
    coordSets: Object.fromEntries(shader.coordSets),
    tfactors: Object.fromEntries([...shader.tfactors].map(([t, v]) => [t, v >>> 0])),
    alphaRefs: Object.fromEntries(shader.alphaRefs),
    choices,
    palettes: (shader.paletteFactors ?? []).map((p) => ({ tag: p.tag, palette: p.palette, variable: p.variable, private: p.private, default: p.default })),
  };
}

/** A blueprint (texture renderer) as the game can run it: geometry, commands, shaders and the prepare operations with their variables. */
export function exportBlueprint(vfs, bp, ctx, registry, loadImage) {
  const load = (file) => loadImage(vfs, file, ctx.images);
  const shaders = bp.shaders.map((s) => exportShader(loadShader(vfs, s.inline ?? s.file, ctx), registry, load));
  const textures = bp.textures.map((file) => registry.idFor(file, load(file)));
  return {
    width: bp.width,
    height: bp.height,
    camera: bp.camera,
    shaders,
    textures,
    vertexBuffers: bp.vertexBuffers.map((vb) => vb.map((v) => [Number(v.x.toFixed(4)), Number(v.y.toFixed(4)), v.color >>> 0, ...v.uv.flatMap((set) => [Number(set[0].toFixed(5)), Number((set[1] ?? 0).toFixed(5))])])),
    uvSets: bp.vertexBuffers.map((vb) => (vb[0]?.uv.length ?? 0)),
    indexBuffers: bp.indexBuffers.map((ib) => [...ib]),
    commands: bp.commands,
    prepare: bp.prepare,
    variables: bp.variables.map((v) => ({ name: v.name, private: v.private, kind: v.kind, default: v.default, ...(v.palette ? { palette: v.palette } : {}), ...(v.max !== undefined ? { max: v.max } : {}) })),
  };
}

/** Every palette named by the recipes, as colour lists. */
export function exportPalettes(vfs, paths) {
  const out = {};
  for (const p of paths) {
    if (out[p]) continue;
    try {
      out[p] = vfs.has(p) ? parsePalette(vfs.read(p)).map(([r, g, b, a]) => [r, g, b, a]) : [];
    } catch {
      out[p] = [];
    }
  }
  return out;
}

/** The palette paths a recipe's shaders and blueprints name. */
export function palettesOf(recipe) {
  const out = new Set();
  const fromShader = (sh) => {
    for (const p of sh?.palettes ?? []) out.add(p.palette);
  };
  fromShader(recipe.shader);
  for (const slot of recipe.slots ?? []) {
    for (const sh of slot.blueprint.shaders) fromShader(sh);
    for (const op of slot.blueprint.prepare) if (op.kind === 'palette') out.add(op.palette);
  }
  return [...out];
}
