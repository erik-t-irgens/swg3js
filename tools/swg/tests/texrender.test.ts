// The browser's texture renderer against known answers: a modulate stage with a palette factor,
// a blueprint drawn from a fan, a texture choice, and the exporter's shape feeding it.
import assert from 'node:assert/strict';
import { bakeShader, liveShader, renderBlueprint, renderRecipe, recipeVariables, type BlueprintDef, type Img, type Recipe, type ShaderDef } from '../../../src/player/texrender.ts';
import { exportShader, ImageRegistry, palettesOf } from '../customize.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

// A 2x2 texture: grey 128 with alpha 255, a white texel, a black one, a half-alpha one.
const tex: Img = { width: 2, height: 2, rgba: new Uint8Array([128, 128, 128, 255, 255, 255, 255, 255, 0, 0, 0, 255, 200, 100, 50, 128]) };
const images = (file: string | null): Img | null => (file === 'skin.png' ? tex : file === 'alt.png' ? { width: 1, height: 1, rgba: new Uint8Array([10, 20, 30, 255]) } : null);
const palettes = { 'palette/skin.pal': [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]] };

// Pass: colour = texture * tfactor (op 3 modulate, args texture(4) and tfactor(5)); alpha = texture's (arg1 = texture).
const shader: ShaderDef = {
  effect: 'test.eff',
  passes: [{ alphaBlend: false, blendOp: 0, blendSrc: 1, blendDst: 0, alphaTest: false, alphaRefTag: null, alphaFunc: 7, writeMask: 15, tfactorTag: 'TFAC', stages: [{ colorOp: 3, colorArgs: [[0, 0, 0], [4, 0, 0], [5, 0, 0]], alphaOp: 1, alphaArgs: [[0, 0, 0], [4, 0, 0], [0, 0, 0]], result: 0, textureTag: 'MAIN', coordSetTag: 'MAIN' }] }],
  textures: { MAIN: 'skin.png' },
  addresses: { MAIN: [2, 2] },
  coordSets: { MAIN: 0 },
  tfactors: {},
  alphaRefs: {},
  choices: [],
  palettes: [{ tag: 'TFAC', palette: 'palette/skin.pal', variable: '/shared_owner/index_color_skin', private: false, default: 0 }],
};

// Baked with the default (red): the grey texel becomes (128, 0, 0), the white one (255, 0, 0).
let live = liveShader(shader, images, new Map(), palettes)!;
let baked = bakeShader(live, 'MAIN')!;
ok(baked.width === 2 && near(baked.rgba[0], 128) && baked.rgba[1] === 0 && baked.rgba[2] === 0 && baked.rgba[3] === 255, 'a modulate over a red palette factor tints the grey texel red');
ok(baked.rgba[4] === 255 && baked.rgba[5] === 0, 'the white texel is pure red');
ok(baked.rgba[15] === 128, "the half-alpha texel keeps the texture's alpha");
// With the palette index 2 (blue), by short name.
live = liveShader(shader, images, new Map([['index_color_skin', 2]]), palettes)!;
baked = bakeShader(live, 'MAIN')!;
ok(baked.rgba[0] === 0 && near(baked.rgba[2], 128), 'the short variable name picks the blue entry');

// A texture choice: the variable swaps the base texture for the alternative.
const choosing: ShaderDef = { ...shader, palettes: [], choices: [{ tag: 'MAIN', variable: 'index_texture_skin', private: false, default: 0, files: ['skin.png', 'alt.png'] }] };
live = liveShader(choosing, images, new Map([['index_texture_skin', 1]]), palettes)!;
baked = bakeShader(live, 'MAIN')!;
ok(baked.width === 1 && baked.rgba[0] === 10 && baked.rgba[1] === 20 && baked.rgba[2] === 30, 'a texture choice swaps in the alternative image');

// A blueprint: a full-frame fan drawn with the palette shader; the frame is 4x4 over a camera of 1.
const bp: BlueprintDef = {
  width: 4,
  height: 4,
  camera: 1,
  shaders: [shader],
  textures: ['skin.png'],
  vertexBuffers: [[[0, 0, 0xffffffff, 0, 0], [1, 0, 0xffffffff, 1, 0], [1, 1, 0xffffffff, 1, 1], [0, 1, 0xffffffff, 0, 1]]],
  uvSets: [1],
  indexBuffers: [],
  commands: [{ kind: 'clear', clearColor: true, color: 0xff000000 }, { kind: 'draw', shader: 0, primitives: [{ kind: 'fan', vb: 0 }] }],
  prepare: [{ kind: 'palette', shader: 0, tag: 'TFAC', palette: 'palette/skin.pal', variable: 0 }],
  variables: [{ name: '/shared_owner/index_color_skin', private: false, kind: 'palette', default: 1 }],
};
let out = renderBlueprint(bp, new Map(), palettes, images);
ok(out.width === 4 && out.rgba[0] === 0 && out.rgba[1] > 0 && out.rgba[2] === 0, "the blueprint's own default (green) tints the frame");
out = renderBlueprint(bp, new Map([['index_color_skin', 0]]), palettes, images);
ok(out.rgba[0] > 0 && out.rgba[1] === 0, 'a value overrides the prepare operation');
// The recipe: rendered into MAIN, then the mesh shader baked over it with its own factor.
const recipe: Recipe = { mesh: 'body', material: 'shader/skin.sht@body', kind: 'bake', baseTag: 'MAIN', shader, slots: [{ tag: 'MAIN', file: 'skin.trt', blueprint: bp }] };
const deps = recipeVariables(recipe);
ok(deps.has('index_color_skin') && deps.has('/shared_owner/index_color_skin'), 'the recipe knows the variables it reads, long and short');
const made = renderRecipe(recipe, new Map([['index_color_skin', 1]]), palettes, images)!;
ok(made.width === 4 && made.rgba[1] > 0 && made.rgba[0] === 0 && made.rgba[2] === 0, 'a baked recipe renders the blueprint then the shader over it');

// The exporter's shape is what the renderer reads: a converter-side shader object through exportShader.
const written: string[] = [];
const registry = new ImageRegistry((id: string) => written.push(id));
const converterShader = {
  effectFile: 'test.eff',
  effect: { passes: [{ alphaBlend: false, blendOp: 0, blendSrc: 1, blendDst: 0, alphaTest: false, alphaRefTag: null, alphaFunc: 7, writeMask: 15, tfactorTag: 'TFAC', stageList: [{ colorOp: 3, colorArgs: [{ arg: 0, complement: false, alphaReplicate: false }, { arg: 4, complement: false, alphaReplicate: false }, { arg: 5, complement: false, alphaReplicate: false }], alphaOp: 1, alphaArgs: [{ arg: 0, complement: false }, { arg: 4, complement: false }, { arg: 0, complement: false }], result: 0, textureTag: 'MAIN', coordSetTag: 'MAIN' }] }] },
  textures: new Map([['MAIN', tex]]),
  textureFiles: new Map([['MAIN', 'texture/skin.dds']]),
  addresses: new Map([['MAIN', [2, 2]]]),
  coordSets: new Map([['MAIN', 0]]),
  tfactors: new Map(),
  alphaRefs: new Map(),
  textureChoices: [],
  paletteFactors: [{ tag: 'TFAC', palette: 'palette/skin.pal', variable: '/shared_owner/index_color_skin', private: false, default: 0 }],
};
const exported = exportShader(converterShader, registry, () => null) as ShaderDef;
ok(written.length === 1 && exported.textures.MAIN === written[0] && exported.passes![0].stages[0].colorArgs[1][0] === 4, 'the exporter writes the image once and keeps the stage arguments');
ok(palettesOf({ shader: exported, slots: [] } as unknown as Recipe)[0] === 'palette/skin.pal', 'the palettes a recipe needs are listed');
const again = bakeShader(liveShader(exported, (f) => (f === written[0] ? tex : null), new Map(), palettes)!, 'MAIN')!;
ok(again.rgba[0] === baked.rgba[0] || near(again.rgba[0], 128), 'the exported shader bakes like the hand-written one');
console.log(`${checks} checks passed`);
