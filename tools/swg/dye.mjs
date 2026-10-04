// A dye of ours for the worn pieces the game gave no colour at all.
//
// About 230 pieces of each human wardrobe (80 of each Ithorian one) read no palette and no texture
// choice: the Deathtrooper, Snowtrooper and marine armour, the robes, necklaces and backpacks. The game
// never let anybody colour them, so every rule here is ours and the pack says so (`invented: 'dye'` on
// each recipe, a `dye` block in customize.json). What is made is an ordinary colour recipe in the format
// every other garment's already is, so the game's own texture renderer (src/player/texrender.ts) runs it
// with nothing new: a plain pass that lays the piece's own picture down, then one pass of ours that lays
// `2 x grey x colour` over it wherever the mask lets it,
//
//     dst = lerp(dst, 2 * grey * colour, mask * colour.alpha)
//
// with the colour read from a palette of ours whose one entry has an alpha of nought. So any index of
// it -- the 0 every value starts at, the 0..11 a fighter's random look throws -- leaves the piece exactly
// as it was converted, and only a colour carried whole (alpha 255, the picker's later work) dyes it.
//
// The mask and the grey are worked out from the very images the piece's GLB embeds (`glbImages` in
// glb.mjs, decoded from the bytes that go into the file), never from the archives' own textures, so "an
// undyed piece is the GLB" holds by construction whatever a later conversion does to those images. The
// mask leaves alone what a dye should not touch: the dark trim (a share of the piece's own median
// brightness, so a near-black robe is not all trim), the metal (the metal-rough image's blue, which is
// metalness in glTF's layout) and anything that glows. The grey is the picture's brightness scaled so
// that the dyed part averages the game's own median garment brightness, stored at half to leave room for
// the doubling, which is what a dyed piece and a game palette piece of the same swatch come out alike by.
import { createHash } from 'node:crypto';
import { glbImages } from './glb.mjs';
import { decodePng } from './png.mjs';

/** What `wardrobe.json` is stamped with once the dye has been run; `status` asks again below it. */
export const DYE_FORMAT = 1;

/** The variable a dye reads: private, so each piece (and each mesh of it) keeps its own. */
export const DYE_VARIABLE = '/private/index_color_dye';

/** Our palette's key in customize.json; the slash keeps it from ever being a path in the archives. */
export const DYE_PALETTE = 'swg3js/dye';

/**
 * Its one entry: white with an alpha of nought, so every index leaves the piece undyed. It must be set
 * after `exportPalettes`, which writes `[]` for a palette it cannot find in the archives, and an empty
 * palette decodes as opaque white, which would dye everything white.
 */
export const DYE_PALETTE_COLOURS = [[255, 255, 255, 0]];

/**
 * Every number of the mask and the grey. `targetLuminance` is the game's own: the median brightness of the
 * 781 garment main textures a garment palette colours. The rest are ours.
 */
export const DYE_TUNE = { darkCutMax: 0.2, darkCutShare: 0.4, metalLo: 0.3, metalHi: 0.7, glowLo: 0.04, glowHi: 0.16, targetLuminance: 0.58, gainMax: 8 };

/**
 * The three garment palettes in the archives that no converted piece names, kept beside the others so
 * that a picker can offer them. Named one by one and never found by a sweep of `palette/`, which would
 * also find the client's interface palettes.
 */
export const EXTRA_GARMENT_PALETTES = ['palette/wr_warm_colors.pal', 'palette/goggles_reward.pal', 'palette/swamptrooper.pal'];

/** customize.json's own word on what is invented. */
export function dyeBlock(tune = DYE_TUNE) {
  return { format: DYE_FORMAT, variable: DYE_VARIABLE, palette: DYE_PALETTE, brightness: tune.targetLuminance, rule: 'ours: dark, metal and glow kept' };
}

/** The palette factor a dye recipe reads. */
export const DYE_FACTOR = { tag: 'DYE', palette: DYE_PALETTE, variable: DYE_VARIABLE, private: true, default: 0 };

/** The piece's own picture laid down as it stands: texture in, colour and alpha alike. */
export const PLAIN_PASS = {
  alphaBlend: false, blendOp: 0, blendSrc: 4, blendDst: 5, alphaTest: false, alphaRefTag: null, alphaFunc: 8, writeMask: 15, tfactorTag: null,
  stages: [{ colorOp: 2, colorArgs: [[0, 0, 0], [0, 0, 0], [4, 0, 0]], alphaOp: 2, alphaArgs: [[0, 0, 0], [0, 0, 0], [4, 0, 0]], result: 1, textureTag: 'MAIN', coordSetTag: 'MAIN' }],
};

/**
 * The dye: colour `modulate2x(grey, factor)`, alpha `mask x factor.alpha`, blended source-alpha over
 * inverse-source-alpha onto what the passes before it drew, colour only (the piece's alpha stays the
 * first pass's, as every bake's does).
 */
export const DYE_PASS = {
  alphaBlend: true, blendOp: 0, blendSrc: 4, blendDst: 5, alphaTest: false, alphaRefTag: null, alphaFunc: 8, writeMask: 7, tfactorTag: 'DYE',
  stages: [{ colorOp: 4, colorArgs: [[0, 0, 0], [4, 0, 0], [5, 0, 0]], alphaOp: 3, alphaArgs: [[0, 0, 0], [4, 0, 0], [5, 0, 0]], result: 1, textureTag: 'DYEB', coordSetTag: 'MAIN' }],
};

/** Hermite step from a to b; a step at b when there is no ramp (a near-black piece's dark cut is nought). */
export function smoothstep(a, b, x) {
  if (b <= a) return x > b ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Brightness of a stored colour, 0..1, weighted as the eye weights it. */
export const luminance = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Whether a recipe reads a variable of the game's: a palette, a texture choice or a rendered blueprint. */
export function readsVariable(recipe) {
  const s = recipe?.shader;
  return (s?.palettes ?? []).some((p) => p.palette !== DYE_PALETTE) || (s?.choices ?? []).length > 0 || (recipe?.slots ?? []).length > 0;
}

/**
 * Why a material of an uncoloured piece is left undyed, or null to dye it: the wearer's own skin (it
 * takes the skin colour), a blended lens, an invisible piece, and the few looks that move or glow whole
 * (a flip-book or a scroll swaps its own map, an unlit screen is all glow).
 */
export function dyeSkip(material, tex) {
  if (/skin_body\.sht$/i.test(material)) return 'skin';
  if (!tex) return 'untextured';
  if (tex.invisible || /appearance_invisible/i.test(material)) return 'invisible';
  if (tex.alphaMode === 'BLEND' || tex.blend || tex.translucent) return 'blended';
  if (tex.anim || tex.scroll) return 'moving';
  if (tex.unlit) return 'unlit';
  return null;
}

const nearest = (img, x, y, w, h) => {
  if (img.width === w && img.height === h) return (y * w + x) * 4;
  const jx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / w));
  const jy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / h));
  return (jy * img.width + jx) * 4;
};

/**
 * The dye images for one mesh's materials, worked out together so the contrast between them is kept (a
 * robe's six materials take one dark cut and one gain). Each material is `{ base, mr, emissive, cutout }`,
 * decoded images as the GLB embeds them, `cutout` when its alpha cuts it (only texels at half alpha or
 * more are shown, as the GLB's mask mode shows them). Returns the dark cut, the brightness under the mask,
 * the gain and whether it was capped, and per material the image of ours (RGB the grey at half, A the
 * mask) with how many texels are shown and how much of them the dye covers, counted from the mask as
 * stored, so a test that decodes the written image counts exactly the same.
 */
export function dyeMask(materials, tune = DYE_TUNE) {
  const hist = new Float64Array(256);
  let shownAll = 0;
  for (const m of materials) {
    const { rgba } = m.base;
    for (let o = 0; o < rgba.length; o += 4) {
      if (m.cutout && rgba[o + 3] < 128) continue;
      hist[Math.max(rgba[o], rgba[o + 1], rgba[o + 2])]++;
      shownAll++;
    }
  }
  let median = 0;
  for (let v = 0, seen = 0; v < 256; v++) {
    seen += hist[v];
    if (seen * 2 >= shownAll) {
      median = v / 255;
      break;
    }
  }
  const darkCut = Math.min(tune.darkCutMax, tune.darkCutShare * median);
  let lsum = 0;
  let msum = 0;
  const fields = materials.map((m) => {
    const { width: w, height: h, rgba } = m.base;
    const mask = new Float32Array(w * h);
    const lum = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = i * 4;
        const v = Math.max(rgba[o], rgba[o + 1], rgba[o + 2]) / 255;
        let k = smoothstep(darkCut / 2, darkCut, v);
        if (m.mr) k *= 1 - smoothstep(tune.metalLo, tune.metalHi, m.mr.rgba[nearest(m.mr, x, y, w, h) + 2] / 255);
        if (m.emissive) {
          const e = nearest(m.emissive, x, y, w, h);
          k *= 1 - smoothstep(tune.glowLo, tune.glowHi, luminance(m.emissive.rgba[e], m.emissive.rgba[e + 1], m.emissive.rgba[e + 2]));
        }
        mask[i] = k;
        lum[i] = luminance(rgba[o], rgba[o + 1], rgba[o + 2]);
        if (m.cutout && rgba[o + 3] < 128) continue;
        lsum += k * lum[i];
        msum += k;
      }
    }
    return { mask, lum };
  });
  const lref = msum > 0 ? lsum / msum : 0;
  const wanted = lref > 0 ? tune.targetLuminance / lref : 1;
  const gain = Math.min(tune.gainMax, wanted);
  const out = materials.map((m, k) => {
    const { width: w, height: h, rgba } = m.base;
    const { mask, lum } = fields[k];
    const image = new Uint8Array(w * h * 4);
    let shown = 0;
    let covered = 0;
    for (let i = 0; i < w * h; i++) {
      const grey = Math.round(Math.min(1, Math.max(0, (lum[i] * gain) / 2)) * 255);
      const a = Math.round(mask[i] * 255);
      image[i * 4] = image[i * 4 + 1] = image[i * 4 + 2] = grey;
      image[i * 4 + 3] = a;
      if (m.cutout && rgba[i * 4 + 3] < 128) continue;
      shown++;
      covered += a / 255;
    }
    return { image: { width: w, height: h, rgba: image }, shown, covered };
  });
  return { median, darkCut, lref, gain, wanted, capped: wanted > tune.gainMax, materials: out };
}

/** How much of a written dye image's shown texels the dye covers: the converter's count, from the pixels. */
export function dyeCoverage(dyeb, base, cutout) {
  let shown = 0;
  let covered = 0;
  for (let i = 0; i < dyeb.width * dyeb.height; i++) {
    if (cutout && base.rgba[i * 4 + 3] < 128) continue;
    shown++;
    covered += dyeb.rgba[i * 4 + 3] / 255;
  }
  return { shown, covered };
}

/** A material with no recipe: its picture as the GLB wears it, then the dye. */
export function plainDyeRecipe(mesh, material, mainFile, dyeFile) {
  return {
    mesh,
    material,
    kind: 'bake',
    baseTag: 'MAIN',
    shader: { effect: null, passes: [PLAIN_PASS, DYE_PASS], textures: { MAIN: mainFile, DYEB: dyeFile }, addresses: {}, coordSets: {}, tfactors: {}, alphaRefs: {}, choices: [], palettes: [{ ...DYE_FACTOR }] },
    slots: [],
    invented: 'dye',
  };
}

/** A recipe that reads no variable (the game's own passes at fixed factors), with the dye appended; a new object. */
export function withDye(recipe, dyeFile) {
  const s = recipe.shader;
  return {
    ...recipe,
    shader: { ...s, passes: [...(s.passes ?? []), DYE_PASS], textures: { ...s.textures, DYEB: dyeFile }, palettes: [...(s.palettes ?? []), { ...DYE_FACTOR }] },
    invented: 'dye',
  };
}

/**
 * Dyes one mesh of a piece the game gave no colour: `targets` are its materials that take a dye, each
 * `{ material, tex, recipe }` with the texture entry its GLB was built from and its recipe when it has one
 * (which then reads no variable). The images go through `registry` (customize.mjs's ImageRegistry): the
 * GLB's base as `MAIN` for a material with no recipe, keyed by the shader since every mesh wears the same
 * one, and the dye image keyed by what it holds, since two meshes that share a shader share it only when
 * their numbers come out the same (a left and a right glove do). Returns each material's recipe -- new,
 * or its own with the dye appended -- with how much of it is covered, and the mesh's numbers.
 */
export function dyeMesh(mesh, targets, registry, tune = DYE_TUNE) {
  const decoded = [];
  for (const t of targets) {
    const embedded = glbImages(t.tex);
    const base = embedded ? decodePng(embedded.base.png) : null;
    if (!base) continue;
    const cutout = (t.tex.alphaMode ?? 'OPAQUE') === 'MASK' && !!t.tex.hasAlpha;
    decoded.push({ t, base, mr: embedded.mr ? decodePng(embedded.mr.png) : null, emissive: embedded.emissive ? decodePng(embedded.emissive.png) : null, cutout });
  }
  if (!decoded.length) return null;
  const mask = dyeMask(decoded, tune);
  const stem = (material) => material.replace(/\.[^./]+$/, '');
  const made = decoded.map((d, k) => {
    const { image, shown, covered } = mask.materials[k];
    const hash = createHash('sha1').update(`${image.width}x${image.height}`).update(image.rgba).digest('hex').slice(0, 12);
    const dyeFile = registry.idFor(`${stem(d.t.material)}_dye_${hash}`, image);
    const recipe = d.t.recipe ? withDye(d.t.recipe, dyeFile) : plainDyeRecipe(mesh, d.t.material, registry.idFor(`${stem(d.t.material)}_main`, d.base), dyeFile);
    return { material: d.t.material, recipe, replaces: d.t.recipe ?? null, shown, covered };
  });
  return { ...mask, made };
}

/** What an item takes, from the recipes on its meshes: a colour of the game's, a dye of ours, or nothing. */
export function colourOf(recipes) {
  if (recipes.some(readsVariable)) return 'palette';
  if (recipes.some((r) => r.invented === 'dye')) return 'dye';
  return 'none';
}

/**
 * Why `status` asks for a wardrobe folder again, as far as the colours and the hair pictures go: a pack
 * stamped before the dye, a pack whose garments carry none (the named product the new conversion must
 * make, so a stamp written by a broken run cannot pass for the real thing), and hairstyles with no
 * picture in a folder that has pictures at all. A folder converted with `--no-dye` or `--no-icons` was
 * the owner's choice and is not asked for again on that account.
 */
export function wardrobeColourStatus(wardrobe) {
  const items = Array.isArray(wardrobe?.items) ? wardrobe.items : [];
  const meshed = items.filter((i) => i && Array.isArray(i.parts) && i.parts.length);
  const wear = meshed.filter((i) => i.kind !== 'hair');
  const hair = meshed.filter((i) => i.kind === 'hair');
  const why = [];
  if (!wardrobe?.noDye) {
    if ((wardrobe?.dyeFormat ?? 0) < DYE_FORMAT) why.push('was converted before every garment could be coloured');
    if (wear.length && !wear.some((i) => i.colour === 'dye')) why.push('has no garment carrying a dye of ours');
  }
  if (hair.length && items.some((i) => i?.icon) && !hair.some((i) => i.icon)) why.push('has no pictures of its hairstyles');
  return why;
}
