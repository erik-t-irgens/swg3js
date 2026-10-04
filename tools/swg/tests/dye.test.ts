// The dye of ours (tools/swg/dye.mjs) and the every-pass palette rule (shaderNeedsBake's `allPasses`), on
// images and shaders made up here, so each rule can be seen doing exactly one thing: a black, a metal and
// a glowing texel are left alone while a mid grey takes the dye; the recipe the dye writes, run through the
// game's own renderer, gives back the picture it was made from at any index of our palette and dyes only
// what the mask lets it under a colour carried whole; and a palette laid on in a later pass is kept while a
// fixed factor there is not. Last, a worn piece whose bake keeps a glow (the two Ithorian GCW helmets), recoloured
// by the game's own customizer: its lit half goes on the colour and its glow on the glow map it already has, never
// the whole render on the colour under the converted glow. The real wardrobe's output is dyeConvert.test.ts's.
//
// Run: node tools/swg/tests/dye.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DYE_FORMAT, DYE_PALETTE, DYE_PALETTE_COLOURS, DYE_PASS, DYE_TUNE, DYE_VARIABLE, EXTRA_GARMENT_PALETTES, colourOf, dyeBlock, dyeCoverage, dyeMask, dyeSkip, plainDyeRecipe, readsVariable, smoothstep, wardrobeColourStatus, withDye } from '../dye.mjs';
import { glbImages } from '../glb.mjs';
import { encodePng } from '../png.mjs';
import { maskOf as converterMaskOf, splitGlow as converterSplitGlow } from '../surface.mjs';
import { shaderNeedsBake } from '../texrender.mjs';
import { Customizer, type RenderShare } from '../../../src/player/customizer.ts';
import { renderRecipe } from '../../../src/player/texrender.ts';
import { runPaintJob } from '../../../src/vehicles/paintJob.ts';
import { DYE_PALETTE as RUNTIME_DYE_PALETTE } from '../../../src/ui/creatorModel.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

type Img = { width: number; height: number; rgba: Uint8Array };
const img = (texels: number[][], width = texels.length, height = 1): Img => ({ width, height, rgba: Uint8Array.from(texels.flat()) });

// ---------------------------------------------------------------- the mask

{
  // Four texels: black, a mid grey, the same grey on metal, the same grey glowing.
  const base = img([[0, 0, 0, 255], [128, 128, 128, 255], [128, 128, 128, 255], [128, 128, 128, 255]]);
  const mr = img([[0, 200, 0, 255], [0, 200, 0, 255], [0, 200, 255, 255], [0, 200, 0, 255]]);
  const emissive = img([[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255]]);
  const r = dyeMask([{ base, mr, emissive, cutout: false }]);
  const a = (i: number) => r.materials[0].image.rgba[i * 4 + 3];
  ok(a(0) === 0, 'a black texel is dark trim and is left alone');
  ok(a(1) === 255, 'a mid grey takes the dye whole');
  ok(a(2) === 0, "a texel the metal-rough image's blue calls metal is left alone");
  ok(a(3) === 0, 'a texel that glows is left alone');
  ok(Math.abs(r.darkCut - Math.min(DYE_TUNE.darkCutMax, DYE_TUNE.darkCutShare * (128 / 255))) < 1e-9, `the dark cut is a share of the median brightness, capped (${r.darkCut.toFixed(3)})`);
  const L = (0.2126 + 0.7152 + 0.0722) * 128 / 255;
  ok(Math.abs(r.lref - L) < 1e-6 && Math.abs(r.gain - DYE_TUNE.targetLuminance / L) < 1e-6, 'the gain brings the brightness under the mask to the game\'s median garment');
  const grey = r.materials[0].image.rgba[1 * 4];
  ok(grey === Math.round(Math.min(1, (L * r.gain) / 2) * 255) && grey === r.materials[0].image.rgba[1 * 4 + 1], `the grey is stored at half for the doubling (${grey})`);
  ok(r.materials[0].shown === 4 && Math.abs(r.materials[0].covered - 1) < 1e-9, 'coverage is counted from the mask as stored');
  ok(dyeCoverage(r.materials[0].image, base, false).covered === r.materials[0].covered, 'and counting it again from the image gives the same');
}

{
  // A near-black robe: its dark cut is a share of its own median, so it is not all trim, and its gain is capped.
  const dark = img([[6, 6, 6, 255], [12, 12, 12, 255], [14, 14, 14, 255], [16, 16, 16, 255]]);
  const r = dyeMask([{ base: dark, mr: null, emissive: null, cutout: false }]);
  ok(r.darkCut < 0.1 && r.materials[0].covered > 2, `a near-black piece keeps most of itself dyeable (dark cut ${r.darkCut.toFixed(3)}, ${r.materials[0].covered.toFixed(2)} of 4)`);
  ok(r.capped && r.gain === DYE_TUNE.gainMax, 'and its brightness is capped at the gain the tune allows');
  // A cut-out's clear texels are neither counted nor allowed to move the median.
  const cut = img([[200, 200, 200, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  const c = dyeMask([{ base: cut, mr: null, emissive: null, cutout: true }]);
  ok(c.materials[0].shown === 1 && c.median === 200 / 255, 'a cut-out counts only the texels it shows');
  // Two materials of one mesh take one dark cut: the darker one is not judged against itself alone.
  const light = img([[200, 200, 200, 255], [200, 200, 200, 255], [200, 200, 200, 255]]);
  const deep = img([[20, 20, 20, 255]]);
  const two = dyeMask([{ base: light, mr: null, emissive: null, cutout: false }, { base: deep, mr: null, emissive: null, cutout: false }]);
  ok(two.darkCut === DYE_TUNE.darkCutMax && two.materials[1].image.rgba[3] === 0, "a mesh's materials share one dark cut, so a dark lining under a light coat stays trim");
  ok(smoothstep(0, 0, 0) === 0 && smoothstep(0, 0, 0.01) === 1 && Math.abs(smoothstep(0.1, 0.2, 0.15) - 0.5) < 1e-12, 'the step has no ramp when there is none to have, and is a hermite ramp otherwise');
}

// ---------------------------------------------------------------- the recipe, through the game's own renderer

{
  // A 2x2 picture with a cut-out corner; the dye image beside it: full mask on two texels, half on one, none on one.
  const main = img([[200, 100, 50, 255], [90, 90, 90, 255], [10, 10, 10, 255], [255, 255, 255, 0]], 2, 2);
  const dyeb = img([[100, 100, 100, 255], [60, 60, 60, 128], [5, 5, 5, 0], [120, 120, 120, 255]], 2, 2);
  const files: Record<string, Img> = { main, dyeb };
  const images = (f: string | null) => (f ? files[f] ?? null : null);
  const recipe = plainDyeRecipe('mesh', 'shader/x.sht', 'main', 'dyeb');
  const key = `mesh|${DYE_VARIABLE}`;
  const ours = { [DYE_PALETTE]: DYE_PALETTE_COLOURS };
  const same = (a: { rgba: ArrayLike<number> } | null, b: Img) => !!a && a.rgba.length === b.rgba.length && Array.from(a.rgba).every((v, i) => v === b.rgba[i]);
  ok(same(renderRecipe(recipe as never, new Map(), ours, images), main), 'undyed, the recipe gives back the picture it was made from, byte for byte');
  ok([0, 5, 11, 255].every((v) => same(renderRecipe(recipe as never, new Map([[key, v]]), ours, images), main)), "and so it does at any index of our palette (a fighter's random look throws 0 to 11)");
  const red = renderRecipe(recipe as never, new Map([[key, 0]]), { [DYE_PALETTE]: [[200, 30, 30, 255]] }, images)!;
  ok(red.rgba[0] !== main.rgba[0] && red.rgba[4] !== main.rgba[4], 'a colour carried whole dyes the masked texels');
  ok([8, 9, 10, 11].every((i) => red.rgba[i] === main.rgba[i]), 'and leaves an unmasked texel exactly as it was');
  ok(red.rgba[3] === 255 && red.rgba[15] === 0, "the piece's own alpha stays the first pass's");
  ok(Math.abs(red.rgba[0] - Math.round(Math.min(1, (2 * 100 * 200) / (255 * 255)) * 255)) <= 1, 'a full mask lays down twice the grey times the colour');
  // The dye appended to a recipe that reads no variable: a new object, the original left as it was.
  const game = { mesh: 'mesh', material: 'shader/y.sht', kind: 'bake', baseTag: 'MAIN', shader: { effect: 'effect/a.eft', passes: [{ ...recipe.shader.passes[0] }], textures: { MAIN: 'main' }, addresses: {}, coordSets: {}, tfactors: {}, alphaRefs: {}, choices: [], palettes: [] }, slots: [] };
  const before = JSON.stringify(game);
  const dyed = withDye(game, 'dyeb');
  ok(JSON.stringify(game) === before && dyed.shader.passes.length === 2 && dyed.shader.passes[1] === DYE_PASS && dyed.invented === 'dye', 'appending the dye writes a new recipe and leaves the one it was given alone');
  ok(same(renderRecipe(dyed as never, new Map(), ours, images), renderRecipe(game as never, new Map(), ours, images) as Img), 'and undyed it renders exactly what the recipe it was appended to does');
  ok(!readsVariable(dyed) && readsVariable({ shader: { palettes: [{ palette: 'palette/wr_cloth_general.pal' }], choices: [] }, slots: [] }), "our palette is not a variable of the game's, a garment palette is");
  ok(colourOf([dyed]) === 'dye' && colourOf([game]) === 'none' && colourOf([dyed, { shader: { palettes: [{ palette: 'palette/x.pal' }], choices: [] }, slots: [] }]) === 'palette', 'a piece takes a palette of the game\'s first, then a dye of ours, else nothing');
}

// ---------------------------------------------------------------- which materials

{
  ok(dyeSkip('shader/skin_body.sht', { alphaMode: 'OPAQUE' }) === 'skin', "the wearer's skin takes the skin colour, not a dye");
  ok(dyeSkip('shader/lens.sht', { alphaMode: 'BLEND' }) === 'blended', 'a blended lens is left clear');
  ok(dyeSkip('shader/appearance_invisible.sht', { invisible: true }) === 'invisible' && dyeSkip('shader/x.sht', null) === 'untextured', 'nothing is dyed that draws nothing');
  ok(dyeSkip('shader/cloth.sht', { alphaMode: 'MASK', hasAlpha: true }) === null, 'a cut-out cloth is dyed');
}

// ---------------------------------------------------------------- what a GLB embeds

{
  const plain = { path: 'p', png: Buffer.from('a') };
  const lit = { path: 'p#lit', png: Buffer.from('b') };
  const rgb = { path: 'p#rgb', png: Buffer.from('c') };
  ok(glbImages({ ...plain, lit, emissive: { path: 'e', png: Buffer.from('d') } })!.base === lit, 'the base a GLB embeds is the lit half of a glowing texture');
  ok(glbImages({ ...plain, rgb })!.base === rgb && glbImages(plain)!.base === plain, 'the opaque colour of a split one, or the texture itself');
  ok(glbImages({ ...plain, mr: { png: Buffer.from('m') } })!.mr!.path === 'p#mr' && glbImages({ invisible: true }) === null, 'the metal-rough image under its own name; an invisible piece embeds nothing');
}

// ---------------------------------------------------------------- the every-pass rule

{
  const stage = (tag: string, args: number[]) => ({ colorOp: 3, colorArgs: args.map((arg) => ({ arg })), alphaArgs: [{ arg: 0 }], textureTag: tag });
  const pass = (tfactorTag: string | null, stages: object[]) => ({ tfactorTag, stageList: stages });
  // The h_color2w shape: a plain first pass, the palettes laid on in passes 1 and 2, a fixed black specular after.
  const shader = {
    effect: { passes: [pass(null, [stage('MAIN', [0, 4, 1])]), pass('MAIN', [stage('MAIN', [0, 5, 0])]), pass('HUEB', [stage('HUEB', [0, 5, 0])]), pass('BLCK', [stage('SPEC', [0, 5, 4])])] },
    tfactors: new Map([['MAIN', 0xff806040], ['HUEB', 0xffffffff], ['BLCK', 0xff000000]]),
    textures: new Map([['MAIN', {}], ['HUEB', {}], ['SPEC', {}]]),
    paletteFactors: [{ tag: 'MAIN' }, { tag: 'HUEB' }],
    textureChoices: [],
  };
  ok(!shaderNeedsBake(shader) && shaderNeedsBake(shader, 'MAIN', { allPasses: true }), 'a palette laid on after the first pass is missed by the first-pass rule and kept by the every-pass one');
  const specular = { ...shader, paletteFactors: [] };
  ok(!shaderNeedsBake(specular, 'MAIN', { allPasses: true }), 'a later pass with a fixed factor or texture (the black specular) is not a reason to bake');
  const chosen = { ...specular, textureChoices: [{ tag: 'SPEC' }] };
  ok(shaderNeedsBake(chosen, 'MAIN', { allPasses: true }), 'a later pass reading a texture a choice picks is');
}

// ---------------------------------------------------------------- the pack's words and what status asks

{
  ok(DYE_PALETTE_COLOURS.length === 1 && DYE_PALETTE_COLOURS[0][3] === 0, 'our palette is one entry with an alpha of nought');
  ok(RUNTIME_DYE_PALETTE === DYE_PALETTE, 'and the appearance page knows it by the name the converter writes');
  ok(dyeBlock().variable === DYE_VARIABLE && dyeBlock().palette === DYE_PALETTE && dyeBlock().brightness === DYE_TUNE.targetLuminance && dyeBlock().format === DYE_FORMAT, 'the pack says which variable and palette are ours, and by what rule');
  ok(EXTRA_GARMENT_PALETTES.length === 3 && EXTRA_GARMENT_PALETTES.every((p) => /^palette\/[a-z_]+\.pal$/.test(p) && !/^palette\/ui/.test(p)), 'the three extra garment palettes are named one by one, none an interface palette');
  const wear = (colour: string, icon = 'icons/x.png') => ({ id: 'x', kind: 'wearables', parts: [{ name: 'm' }], icon, colour, slots: [] });
  const hair = (icon: string | null) => ({ id: 'h', kind: 'hair', parts: [{ name: 'h' }], icon, colour: 'palette', slots: [] });
  ok(wardrobeColourStatus({ items: [wear('dye'), hair('icons/h.png')] }).some((w) => /before every garment/.test(w)), 'a wardrobe stamped before the dye is asked for again');
  ok(wardrobeColourStatus({ dyeFormat: DYE_FORMAT, items: [wear('palette'), hair('icons/h.png')] }).some((w) => /no garment carrying/.test(w)), 'so is one stamped but carrying no dyed garment');
  ok(wardrobeColourStatus({ dyeFormat: DYE_FORMAT, items: [wear('dye'), hair(null)] }).some((w) => /hairstyles/.test(w)), 'and one whose hairstyles have no pictures');
  ok(wardrobeColourStatus({ dyeFormat: DYE_FORMAT, items: [wear('dye'), hair('icons/h.png')] }).length === 0, 'a whole one is left alone');
  ok(wardrobeColourStatus({ noDye: true, items: [wear('none'), hair('icons/h.png')] }).length === 0, 'a folder converted with --no-dye is not asked for again on that account');
  ok(wardrobeColourStatus({ dyeFormat: DYE_FORMAT, items: [wear('dye', null as never), hair(null)] }).length === 0, 'nor is one converted with --no-icons for its hair pictures');
}

// ---------------------------------------------------------------- a bake that keeps its glow, recoloured

{
  // A 2x2 piece: its picture times a palette colour (the bake), and a glow mask in another texture's alpha that
  // lights two texels whole, one by half and one not at all -- the GCW helmets' shape (`EMIS.a`).
  const PALETTE = 'palette/test.pal';
  const COLOURS = [[255, 255, 255, 255], [255, 64, 32, 255]];
  const main = img([[200, 180, 160, 255], [120, 120, 120, 255], [60, 90, 200, 255], [250, 250, 250, 255]], 2, 2);
  const emisTex = img([[0, 0, 0, 255], [0, 0, 0, 128], [0, 0, 0, 255], [0, 0, 0, 0]], 2, 2);
  const recipe = {
    mesh: 'helmet_m_l0',
    material: 'shader/helmet.sht',
    kind: 'bake',
    baseTag: 'MAIN',
    shader: {
      effect: 'effect/h_color2w_x.eft',
      passes: [{ alphaBlend: false, blendOp: 0, blendSrc: 4, blendDst: 5, alphaTest: false, alphaRefTag: null, alphaFunc: 8, writeMask: 15, tfactorTag: 'TFAC', stages: [{ colorOp: 3, colorArgs: [[0, 0, 0], [4, 0, 0], [5, 0, 0]], alphaOp: 2, alphaArgs: [[0, 0, 0], [0, 0, 0], [4, 0, 0]], result: 1, textureTag: 'MAIN', coordSetTag: 'MAIN' }] }],
      textures: { MAIN: 'main.png', EMIS: 'emis.png' },
      addresses: {},
      coordSets: {},
      tfactors: {},
      alphaRefs: {},
      choices: [],
      palettes: [{ tag: 'TFAC', palette: PALETTE, variable: '/private/index_color_1', private: true, default: 0 }],
    },
    slots: [],
    glow: { maskTag: 'EMIS', channel: 'a', keepAlpha: true },
  };
  const files: Record<string, Img> = { 'main.png': main, 'emis.png': emisTex };
  const images = (f: string | null) => (f ? files[f] ?? null : null);
  const palettes = { [PALETTE]: COLOURS };
  const key = 'helmet_m_l0|/private/index_color_1';
  const values = new Map([[key, 1]]);

  // What the converter writes at the defaults, split by its own functions (surface.mjs), is exactly what the
  // game's split job (paintJob.ts) makes of the recipe: the lit half is the GLB's base, the glow its emissive.
  const bake = renderRecipe(recipe as never, new Map(), palettes, images)!;
  const m = converterMaskOf(bake, emisTex, 'a')!;
  const converted = converterSplitGlow(bake, m, true);
  const job = runPaintJob(recipe as never, new Map(), palettes, images)!;
  const bytes = (a: { rgba: ArrayLike<number> } | null | undefined) => (a ? Array.from(a.rgba).join() : '');
  ok(bytes(job) === bytes(converted.lit) && bytes(job.emis) === bytes(converted.emis), "the game's split of the recipe at its defaults is the converter's split of the bake, byte for byte");

  // The game's own customizer, its recipes and images served through a stand-in for `fetch`.
  const DIR = 'http://pack/wardrobe/ithorian_male/';
  const realFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    if (url === `${DIR}customize.json`) return new Response(JSON.stringify({ images: 'customize/', recipes: [recipe], palettes }), { headers: { 'content-type': 'application/json' } });
    const name = url.slice(`${DIR}customize/`.length);
    if (files[name]) return new Response(encodePng(files[name].width, files[name].height, files[name].rgba), { headers: { 'content-type': 'image/png' } });
    return new Response('', { status: 404 });
  };
  const data = (t: THREE.Texture | null): Uint8Array | null => ((t?.image as { data?: Uint8Array } | undefined)?.data ?? null);
  try {
    const recoloured = runPaintJob(recipe as never, values, palettes, images)!;
    const whole = renderRecipe(recipe as never, values, palettes, images)!;

    // A material with a glow map, as the helmet's GLB gives it: the lit half on the colour, the glow on the glow map.
    const fromGlb = new THREE.Texture();
    const helmet = new THREE.MeshStandardMaterial({ name: recipe.material, emissiveMap: fromGlb });
    const cz = new Customizer();
    cz.materialsFor = (name) => (name === recipe.material ? [helmet] : []);
    await cz.addSource(DIR);
    cz.set(key, 1);
    await cz.settled();
    ok(bytes({ rgba: data(helmet.map) ?? [] }) === bytes(recoloured) && bytes(recoloured) !== bytes(whole), 'recoloured, the colour takes the lit half of the render, not the whole of it');
    ok(helmet.emissiveMap !== fromGlb && bytes({ rgba: data(helmet.emissiveMap) ?? [] }) === bytes(recoloured.emis), 'and the glow map takes the glow split from the new colour, so the visor is lit once and in that colour');
    const emis = helmet.emissiveMap;
    helmet.emissiveMap = fromGlb;
    cz.reapply();
    ok(helmet.emissiveMap === emis, 'a part put on again gets the glow back with the colour');

    // A material with no glow map takes the whole render, and is never given one.
    const plain = new THREE.MeshStandardMaterial({ name: recipe.material });
    const other = new Customizer();
    other.materialsFor = (name) => (name === recipe.material ? [plain] : []);
    await other.addSource(DIR);
    other.set(key, 1);
    await other.settled();
    ok(bytes({ rgba: data(plain.map) ?? [] }) === bytes(whole) && plain.emissiveMap === null, 'a material with no glow map takes the whole render and is given none (that would be a new program)');

    // The dressed people's shared renders split the same way, under keys of their own.
    const made = new Map<string, Promise<THREE.Texture | null>>();
    const share: RenderShare = { claim: (k, _kind, make) => made.get(k) ?? (made.set(k, make()), made.get(k)!) };
    const crowd = new THREE.MeshStandardMaterial({ name: recipe.material, emissiveMap: fromGlb });
    const shared = new Customizer();
    shared.share = share;
    shared.materialsFor = (name) => (name === recipe.material ? [crowd] : []);
    await shared.addSource(DIR);
    shared.set(key, 1);
    await shared.settled();
    ok(bytes({ rgba: data(crowd.map) ?? [] }) === bytes(recoloured) && bytes({ rgba: data(crowd.emissiveMap) ?? [] }) === bytes(recoloured.emis), 'a shared render puts the lit half and the glow on a look the mobiles stand');
    ok([...made.keys()].some((k) => k.endsWith('|lit')) && [...made.keys()].some((k) => k.endsWith('|glow')), 'each half under a key of its own');
  } finally {
    (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
  }
}

console.log(`\ndye: ${passed} checks passed`);
