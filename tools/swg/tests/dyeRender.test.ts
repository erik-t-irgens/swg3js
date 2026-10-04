// The colour renderer, raw colours and the picker (the Creator and dye pass, wave 5).
//
// A colour carried whole as a palette value (texrender.ts) is decoded where every palette colour is, and an
// index means what it always meant. Two meshes drawn with one shader name, each with a colour private to it,
// keep a texture each (customizer.ts), while a ship's recipe, which reads only the colours shared by the
// whole hull, keeps the one texture its material has always had. The characters' worker (recipeWorker.worker.ts,
// run here under node with a stand-in for its `self`) hands back exactly the colour and the normal map the
// main thread makes; the renderer's own side of the channel is driven through a stand-in Worker that runs a fresh
// copy of the real worker module, so the normal map a character's answer carries, the none a ship's carries, and a
// glowing piece's split (its lit half on the colour, its glow on the glow map it already has, the whole render on a
// material with none) are each seen arriving where the game puts them; and a render that comes back after its
// recipe was asked for again is not put. Which loaded mesh is a recipe's, and the three lines of Character that
// wire all of this, are pinned too. The picker's own rules -- which tabs a row offers, what a pick on each writes,
// what its palettes are called, the All grid's folding -- and the page's grouping of a worn piece's colours by
// piece are pure and run here too. Last, over what is converted on this machine: our dye on a real wardrobe recipe
// leaves the piece as it was at any index and changes only what its mask lets through under a colour carried
// whole, and leaves a Snowtrooper's visor black; every species' eye colour is read through a palette, so a colour
// carried whole reaches it; no recipe's mesh ends in a suffix the loader could have added; and the All grid holds
// what the design measured.
//
// Run: node tools/swg/tests/dyeRender.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { encodePng, decodePng as decodePngSync } from '../png.mjs';
import { Customizer, isRecipeMesh, perMesh, recipeMeshOf, type RecipeRender } from '../../../src/player/customizer.ts';
import { RAW_COLOUR_MIN, isRawColour, paletteColor, rawColour, rawRgb, recipeNormal, renderRecipe, type Img, type Pass, type Recipe, type ShaderDef, type Values } from '../../../src/player/texrender.ts';
import { makeRecipeRender } from '../../../src/player/recipeWorker.ts';
import { runPaintJob, type JobImg, type PaintRecipe } from '../../../src/vehicles/paintJob.ts';
import { DYE_PALETTE, catalogueName, itemSections, type CreatorTable, type PackColour } from '../../../src/ui/creatorModel.ts';
import { DYE_TUNE, allGarmentColours, countText, creatorPaletteLabel, creatorPalettes, eyePalettes, foldColours, garmentPaletteLabel, garmentPalettes, hexOf, openTab, pickKind, pickValue, pickerTabs, rawFromHex, sortColours, tabBlocks, valueRgb, type PickerSource } from '../../../src/ui/dyePicker.ts';
import { paletteFamily, variableLabel } from '../../../src/ui/variableLabel.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

const bytes = (a: { rgba: ArrayLike<number> } | null | undefined): string => (a ? Array.from(a.rgba).join() : '');
const img = (w: number, h: number, texels: number[][]): Img => ({ width: w, height: h, rgba: Uint8Array.from(texels.flat()) });

// ---------------------------------------------------------------- the files a customizer reads, through a stand-in for `fetch`
const served = new Map<string, Uint8Array | string>();
const realFetch = globalThis.fetch;
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const body = served.get(String(url));
  if (body === undefined) return new Response('', { status: 404 });
  return new Response(body, { headers: { 'content-type': typeof body === 'string' ? 'application/json' : 'image/png' } });
};
const servePng = (url: string, i: Img) => served.set(url, encodePng(i.width, i.height, i.rgba));

// ---------------------------------------------------------------- raw colours
{
  const red = rawColour(200, 30, 30);
  ok(red < 0 && isRawColour(red) && rawRgb(red).join() === '200,30,30', 'a colour carried whole is a negative value, and reads back as itself');
  ok(rawColour(0, 0, 0) === -1 && rawColour(255, 255, 255) === RAW_COLOUR_MIN, 'black is -1 and white the least a palette value may be');
  ok(!isRawColour(0) && !isRawColour(255) && !isRawColour(RAW_COLOUR_MIN - 1) && !isRawColour(-0.5), "an index, a value past white and a fraction are not colours carried whole");
  const pals = { 'palette/x.pal': [[10, 20, 30, 255], [40, 50, 60, 128]] };
  ok(paletteColor(pals, 'palette/x.pal', 0) === 0xff0a141e && paletteColor(pals, 'palette/x.pal', 1) === 0x8028323c >>> 0, "an index is its palette's entry, alpha and all, as it always was");
  ok(paletteColor(pals, 'palette/x.pal', 9) === paletteColor(pals, 'palette/x.pal', 1), 'an index past the end is the last entry, as it always was');
  ok(paletteColor(pals, 'palette/x.pal', red) === 0xffc81e1e >>> 0, 'a colour carried whole is itself, opaque, whatever the palette holds');
  ok(paletteColor({}, 'palette/unknown.pal', red) === 0xffc81e1e >>> 0 && paletteColor({}, 'palette/unknown.pal', 3) === 0xffffffff, 'and even where the palette is not known, where an index is white');
  ok(paletteColor({ [DYE_PALETTE]: [[255, 255, 255, 0]] }, DYE_PALETTE, 5) >>> 24 === 0 && paletteColor({ [DYE_PALETTE]: [[255, 255, 255, 0]] }, DYE_PALETTE, red) >>> 24 === 255, "so our dye's palette dyes nothing at any index and dyes whole under a colour");
  ok(rawFromHex('#c81e1e') === red && rawFromHex('C81E1E') === red && rawFromHex('#fff') === RAW_COLOUR_MIN && rawFromHex('red') === null, 'a #rrggbb is the colour carried whole, and a word is none');
  ok(countText(red, []) === '#c81e1e' && countText(2, [[0, 0, 0], [1, 1, 1], [2, 2, 2]]) === '3/3', "a row's count reads #rrggbb for a colour carried whole and the index of how many otherwise");
  ok(valueRgb(1, [[1, 2, 3], [4, 5, 6]])!.join() === '4,5,6' && valueRgb(red, [])!.join() === '200,30,30' && hexOf([200, 30, 30]) === '#c81e1e', 'a value shows its palette entry or itself');
}

// ---------------------------------------------------------------- a recipe of the game's shape, made up here
const STAGE_MAIN = { colorOp: 4, colorArgs: [[0, 0, 0], [4, 0, 0], [5, 0, 0]], alphaOp: 2, alphaArgs: [[0, 0, 0], [0, 0, 0], [4, 0, 0]], result: 1, textureTag: 'MAIN', coordSetTag: 'MAIN' };
const PASS: Pass = { alphaBlend: false, blendOp: 0, blendSrc: 4, blendDst: 5, alphaTest: false, alphaRefTag: null, alphaFunc: 8, writeMask: 15, tfactorTag: 'MAIN', stages: [STAGE_MAIN as never] };
const PALETTE = 'palette/wr_cloth_general.pal';
const COLOURS = [[128, 128, 128, 255], [255, 64, 32, 255], [32, 64, 255, 255]];
function garment(mesh: string, material: string, priv = true, normal = false): Recipe {
  const shader: ShaderDef = {
    effect: 'effect/h_simple.eft',
    passes: [PASS],
    textures: { MAIN: 'main.png', ...(normal ? { NRML: 'nrml.png' } : {}) },
    addresses: {},
    coordSets: {},
    tfactors: {},
    alphaRefs: {},
    choices: [],
    palettes: [{ tag: 'MAIN', palette: PALETTE, variable: priv ? '/private/index_color_1' : 'index_color_1', private: priv, default: 0 }],
  };
  return { mesh, material, kind: 'bake', baseTag: 'MAIN', shader, slots: [] };
}
const MAIN = img(2, 2, [[200, 200, 200, 255], [100, 100, 100, 255], [50, 150, 250, 255], [255, 255, 255, 255]]);
const NRML = img(2, 2, [[128, 128, 255, 255], [140, 120, 250, 255], [100, 160, 240, 255], [128, 128, 255, 255]]);
const files: Record<string, Img> = { 'main.png': MAIN, 'nrml.png': NRML };
const images = (f: string | null) => (f ? files[f] ?? null : null);
const palettes = { [PALETTE]: COLOURS };

/** A folder of made-up recipes served as a pack is. */
function pack(dir: string, recipes: Recipe[]): void {
  served.set(`${dir}customize.json`, JSON.stringify({ images: 'customize/', recipes, palettes }));
  for (const [name, i] of Object.entries(files)) servePng(`${dir}customize/${name}`, i);
}

// ---------------------------------------------------------------- two meshes on one shader name keep their own colours
{
  const DIR = 'http://pack/gloves/';
  const left = garment('glove_l_m_l0', 'shader/glove.sht');
  const right = garment('glove_r_m_l0', 'shader/glove.sht');
  pack(DIR, [left, right]);
  ok(perMesh(left) && perMesh(right), 'a recipe reading a colour private to its mesh keeps its textures as its mesh\'s own');
  const matL = new THREE.MeshStandardMaterial({ name: 'shader/glove.sht', map: new THREE.Texture() });
  const matR = new THREE.MeshStandardMaterial({ name: 'shader/glove.sht', map: new THREE.Texture() });
  const asked: string[] = [];
  const cz = new Customizer();
  // As a character answers: a mesh's own materials when a mesh is named, every one of the name otherwise.
  cz.materialsFor = (name, mesh) => {
    asked.push(mesh ?? '*');
    if (name !== 'shader/glove.sht') return [];
    if (mesh === 'glove_l_m_l0') return [matL];
    if (mesh === 'glove_r_m_l0') return [matR];
    return [matL, matR];
  };
  await cz.addSource(DIR);
  cz.set('glove_l_m_l0|/private/index_color_1', 1);
  cz.set('glove_r_m_l0|/private/index_color_1', 2);
  await cz.settled();
  const want = (v: number, mesh: string) => renderRecipe(mesh === left.mesh ? left : right, new Map([[`${mesh}|/private/index_color_1`, v]]), palettes, images);
  const data = (t: THREE.Texture | null) => ({ rgba: ((t?.image as { data?: Uint8Array } | undefined)?.data ?? []) as ArrayLike<number> });
  ok(matL.map !== matR.map && bytes(data(matL.map)) === bytes(want(1, left.mesh)) && bytes(data(matR.map)) === bytes(want(2, right.mesh)), 'a left and a right glove on one shader take two colours, each its own texture');
  ok(!asked.includes('*'), 'and a recipe whose colour is its mesh\'s own only ever asks for its own mesh\'s materials');
  ok(cz.stats().perMesh === 2 && cz.stats().textures === 2, `two textures, both a mesh's own (${JSON.stringify(cz.stats())})`);
  ok(cz.textureOf('shader/glove.sht', 'glove_r_m_l0') === matR.map && cz.textureOf('shader/glove.sht') === matL.map, 'what a material last rendered to is found through its recipes, a mesh at a time');
  // Put on again (a part came and went): each texture back on its own mesh's material only.
  matL.map = matR.map = new THREE.Texture();
  cz.reapply();
  ok(bytes(data(matL.map)) === bytes(want(1, left.mesh)) && bytes(data(matR.map)) === bytes(want(2, right.mesh)), 'a part put on again gets its own texture back, not the other glove\'s');
  cz.dispose();
}

// ---------------------------------------------------------------- a ship's recipe keeps the material's one texture
{
  const DIR = 'http://pack/ship/';
  const hull = garment('ship', 'shader/hull.sht', false);
  pack(DIR, [hull]);
  ok(!perMesh(hull), 'a recipe reading only shared colours (a ship\'s paint) is not a mesh\'s own');
  const mat = new THREE.MeshStandardMaterial({ name: 'shader/hull.sht', map: new THREE.Texture() });
  const asked: (string | undefined)[] = [];
  const cz = new Customizer();
  cz.materialsFor = (name, mesh) => {
    asked.push(mesh);
    return name === 'shader/hull.sht' ? [mat] : [];
  };
  await cz.addSource(DIR);
  cz.set('index_color_1', 2);
  await cz.settled();
  ok(asked.every((m) => m === undefined), "its materials are asked for by name alone, as a ship's paint always asked");
  ok(cz.textureOf('shader/hull.sht') === mat.map && cz.stats().perMesh === 0, 'and its texture is the material\'s, where `textureOf` has always found it');
  cz.dispose();
}

// ---------------------------------------------------------------- the characters' worker, run here
{
  const replies: { m: Record<string, unknown>; transfer: unknown[] }[] = [];
  const fakeSelf = { postMessage: (m: Record<string, unknown>, transfer: unknown[] = []) => replies.push({ m, transfer }), onmessage: null as ((e: { data: unknown }) => void) | null };
  (globalThis as unknown as { self: unknown }).self = fakeSelf;
  await import('../../../src/player/recipeWorker.worker.ts');
  ok(typeof fakeSelf.onmessage === 'function', 'the worker answers messages');
  const DIR = 'http://pack/worker/';
  const recipe = garment('shirt_m_l0', 'shader/shirt.sht', true, true);
  pack(DIR, [recipe]);
  const values: [string, number][] = [['shirt_m_l0|/private/index_color_1', 1]];
  fakeSelf.onmessage!({ data: { init: { cacheMB: 4 } } });
  fakeSelf.onmessage!({ data: { id: 7, recipe, values, palettes, dir: `${DIR}customize/`, normal: true } });
  for (let i = 0; i < 200 && !replies.length; i++) await new Promise((r) => setTimeout(r, 5));
  const got = replies[0]?.m as { id: number; width: number; height: number; rgba: Uint8Array; normal?: Img; ms?: number } | undefined;
  const vals: Values = new Map(values);
  ok(!!got && got.id === 7 && bytes(got) === bytes(renderRecipe(recipe, vals, palettes, images)), "the worker's colour is the main thread's renderRecipe, byte for byte");
  ok(!!got?.normal && bytes(got.normal) === bytes(recipeNormal(recipe, vals, palettes, images)), "and its normal map the main thread's recipeNormal, byte for byte");
  ok(!!got && replies[0].transfer.length === 2 && typeof got.ms === 'number', 'both buffers are handed over, not copied, with the time the render took');
  replies.length = 0;
  fakeSelf.onmessage!({ data: { id: 8, recipe, values, palettes, dir: `${DIR}customize/`, normal: false } });
  for (let i = 0; i < 200 && !replies.length; i++) await new Promise((r) => setTimeout(r, 5));
  ok(!!replies[0] && !(replies[0].m as { normal?: unknown }).normal, "a ship's paint, which asks for no normal map, gets none");
  replies.length = 0;
  fakeSelf.onmessage!({ data: { id: 9, recipe: { ...recipe, shader: { ...recipe.shader!, textures: { MAIN: 'gone.png' } } }, values, palettes, dir: `${DIR}customize/`, normal: true } });
  for (let i = 0; i < 200 && !replies.length; i++) await new Promise((r) => setTimeout(r, 5));
  ok(!!replies[0] && (replies[0].m as { empty?: boolean }).empty === true, 'a render missing its picture comes back empty, and nothing is put');

  // A renderer made here has no Worker to make (node has none): it renders on this thread, with a warning once,
  // and a character's customizer puts its colour and its normal map exactly as one rendered here would.
  const warn = console.warn;
  const warned: string[] = [];
  console.warn = (...a: unknown[]) => void warned.push(a.map(String).join(' '));
  try {
    const render = makeRecipeRender({ name: 'characters', cacheMB: 4, withNormal: true });
    const mat = new THREE.MeshStandardMaterial({ name: 'shader/shirt.sht', map: new THREE.Texture() });
    const cz = new Customizer(render, { putsGlow: true });
    cz.materialsFor = (name, mesh) => (name === 'shader/shirt.sht' && (mesh === undefined || mesh === 'shirt_m_l0') ? [mat] : []);
    await cz.addSource(DIR);
    cz.set('shirt_m_l0|/private/index_color_1', 1);
    await cz.settled();
    const data = (t: THREE.Texture | null) => ({ rgba: ((t?.image as { data?: Uint8Array } | undefined)?.data ?? []) as ArrayLike<number> });
    ok(bytes(data(mat.map)) === bytes(renderRecipe(recipe, vals, palettes, images)) && bytes(data(mat.normalMap)) === bytes(recipeNormal(recipe, vals, palettes, images)), 'rendered elsewhere, a character takes its colour and its normal map as the main thread gives them');
    ok(warned.length === 1 && /no module worker/.test(warned[0]) && render.status().where === 'here' && render.status().done >= 1, `with no worker to be had it renders here and says so once (${render.status().where}, ${warned.length} warning)`);
    cz.dispose();
  } finally {
    console.warn = warn;
  }
}

// ---------------------------------------------------------------- the channel to the worker, as a browser runs it
// Node has no Worker, so a stand-in is put where the renderer looks for one: each one made runs a fresh copy of
// the real worker module (its own `self`, its own cache), a message reaches it cloned as a browser clones it, and
// its answer comes back cloned with its buffers handed over. What is tried is the renderer's own side -- the
// job it posts, the answer it reads back, the normal map and the glow it hands on -- which is the path every
// character's colour takes in the game.
interface FakeScope {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}
const workersMade: { url: string; type?: string; posted: Record<string, unknown>[]; transfers: number[] }[] = [];
let workerChain: Promise<unknown> = Promise.resolve();
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private readonly ready: Promise<FakeScope>;
  private readonly made: (typeof workersMade)[number];
  constructor(url: URL, opts?: { type?: string }) {
    this.made = { url: String(url), type: opts?.type, posted: [], transfers: [] };
    workersMade.push(this.made);
    const scope: FakeScope = {
      postMessage: (m, transfer = []) => {
        this.made.transfers.push(transfer.length);
        const data = structuredClone(m, { transfer });
        setTimeout(() => this.onmessage?.({ data }), 0);
      },
      onmessage: null,
    };
    const n = workersMade.length;
    // One module at a time, each read with `self` its own (the module takes `self` as it is first run).
    this.ready = (workerChain = workerChain.then(async () => {
      (globalThis as unknown as { self: unknown }).self = scope;
      await import(`${url.href}?worker=${n}`);
      return scope;
    }));
  }
  postMessage(m: Record<string, unknown>): void {
    this.made.posted.push(m);
    const data = structuredClone(m);
    void this.ready.then((scope) => scope.onmessage?.({ data }));
  }
  terminate(): void {}
}

// A glowing piece, made up here in the shape of the two Ithorian GCW helmets (dye.test.ts holds the converter's
// half): a bake whose shader glows through a mask in another texture's alpha -- two texels whole, one by half, one not.
const GLOW_PALETTE = 'palette/test_glow.pal';
const glowPalettes = { [GLOW_PALETTE]: [[255, 255, 255, 255], [255, 64, 32, 255]] };
const glowFiles: Record<string, Img> = {
  'helmet_main.png': img(2, 2, [[200, 180, 160, 255], [120, 120, 120, 255], [60, 90, 200, 255], [250, 250, 250, 255]]),
  'helmet_emis.png': img(2, 2, [[0, 0, 0, 255], [0, 0, 0, 128], [0, 0, 0, 255], [0, 0, 0, 0]]),
};
const glowImages = (f: string | null) => (f ? glowFiles[f] ?? null : null);
const helmet: PaintRecipe = {
  mesh: 'helmet_m_l0',
  material: 'shader/helmet.sht',
  kind: 'bake',
  baseTag: 'MAIN',
  shader: {
    effect: 'effect/h_color2w_x.eft',
    passes: [{ ...PASS, tfactorTag: 'TFAC', stages: [{ colorOp: 3, colorArgs: [[0, 0, 0], [4, 0, 0], [5, 0, 0]], alphaOp: 2, alphaArgs: [[0, 0, 0], [0, 0, 0], [4, 0, 0]], result: 1, textureTag: 'MAIN', coordSetTag: 'MAIN' } as never] }],
    textures: { MAIN: 'helmet_main.png', EMIS: 'helmet_emis.png' },
    addresses: {},
    coordSets: {},
    tfactors: {},
    alphaRefs: {},
    choices: [],
    palettes: [{ tag: 'TFAC', palette: GLOW_PALETTE, variable: '/private/index_color_1', private: true, default: 0 }],
  },
  slots: [],
  glow: { maskTag: 'EMIS', channel: 'a', keepAlpha: true },
};
const HELMET_DIR = 'http://pack/glow/';
served.set(`${HELMET_DIR}customize.json`, JSON.stringify({ images: 'customize/', recipes: [helmet], palettes: glowPalettes }));
for (const [name, i] of Object.entries(glowFiles)) servePng(`${HELMET_DIR}customize/${name}`, i);

/**
 * The helmet recoloured by a character's customizer over `render`: once on a material with a glow map (as the
 * helmet's GLB gives it), once on one without. What each material ends up wearing.
 */
async function recolourHelmet(render: RecipeRender): Promise<{ glowing: THREE.MeshStandardMaterial; fromGlb: THREE.Texture; plain: THREE.MeshStandardMaterial }> {
  const key = `${helmet.mesh}|/private/index_color_1`;
  const fromGlb = new THREE.Texture();
  const glowing = new THREE.MeshStandardMaterial({ name: helmet.material, emissiveMap: fromGlb });
  const plain = new THREE.MeshStandardMaterial({ name: helmet.material });
  for (const mat of [glowing, plain]) {
    const cz = new Customizer(render, { putsGlow: true });
    cz.materialsFor = (name, mesh) => (name === helmet.material && (mesh === undefined || mesh === helmet.mesh) ? [mat] : []);
    await cz.addSource(HELMET_DIR);
    cz.set(key, 1);
    await cz.settled();
    cz.dispose();
  }
  return { glowing, fromGlb, plain };
}

/** The checks a recoloured helmet must pass wherever it rendered: the glow split as this thread splits it, and never a glow map added. */
function helmetChecks(where: string, got: Awaited<ReturnType<typeof recolourHelmet>>): void {
  const values: Values = new Map([[`${helmet.mesh}|/private/index_color_1`, 1]]);
  const recoloured = runPaintJob(helmet, values, glowPalettes, glowImages)!;
  const whole = renderRecipe(helmet, values, glowPalettes, glowImages)!;
  const data = (t: THREE.Texture | null) => ({ rgba: ((t?.image as { data?: Uint8Array } | undefined)?.data ?? []) as ArrayLike<number> });
  ok(bytes(data(got.glowing.map)) === bytes(recoloured) && bytes(recoloured) !== bytes(whole), `${where}: a glowing piece's colour takes the lit half of its render, not the whole of it`);
  ok(got.glowing.emissiveMap !== got.fromGlb && bytes(data(got.glowing.emissiveMap)) === bytes(recoloured.emis), `${where}: and its glow map the glow split from the new colour, so the visor is lit once and in that colour`);
  ok(bytes(data(got.plain.map)) === bytes(whole) && got.plain.emissiveMap === null, `${where}: a material with no glow map takes the whole render and is given none (that would be a new program)`);
}

{
  // Where no worker can be had, the same split on this thread (the warning was said once already, above).
  const warn = console.warn;
  console.warn = () => {};
  try {
    const here = makeRecipeRender({ name: 'characters', cacheMB: 4, withNormal: true });
    helmetChecks('rendered on this thread', await recolourHelmet(here));
    ok(here.status().where === 'here', 'with no Worker it rendered on this thread');
  } finally {
    console.warn = warn;
  }
}

{
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  try {
    const DIR = 'http://pack/channel/';
    const recipe = garment('vest_m_l0', 'shader/vest.sht', true, true);
    pack(DIR, [recipe]);
    const values: Values = new Map([['vest_m_l0|/private/index_color_1', 2]]);
    const characters = makeRecipeRender({ name: 'characters', cacheMB: 4, withNormal: true });
    const paint = makeRecipeRender({ name: 'paint', cacheMB: 8, withNormal: false });
    ok(characters.status().where === 'idle' && !workersMade.length, 'a renderer makes no worker until it is first asked for a render');

    const answer = await characters(recipe, values, palettes, `${DIR}customize/`);
    const made = workersMade[0];
    ok(!!made && workersMade.length === 1 && made.type === 'module' && /recipeWorker\.worker\.ts$/.test(made.url) && characters.status().where === 'worker', `the first render makes the renderer's own module worker (${made?.url.replace(/^.*\//, '')}, ${made?.type})`);
    ok(made.posted[0]?.init !== undefined && (made.posted[0].init as { cacheMB: number }).cacheMB === 4 && made.posted[1]?.normal === true, 'it is told its cache first, and a character\'s job asks for the normal map');
    ok(!!answer && bytes(answer) === bytes(renderRecipe(recipe, values, palettes, images)), "the colour that comes back through the channel is this thread's renderRecipe, byte for byte");
    ok(!!answer?.normal && bytes(answer.normal) === bytes(recipeNormal(recipe, values, palettes, images)), "and a character's answer carries the normal map, this thread's recipeNormal byte for byte");
    ok(made.transfers[0] === 2 && characters.status().done === 1 && characters.status().inFlight === 0, 'both buffers handed over, the render counted done and nothing left in flight');

    const shipAnswer = await paint(recipe, values, palettes, `${DIR}customize/`);
    ok(workersMade.length === 2 && paint.status().where === 'worker' && workersMade[1].posted[1]?.normal === false, 'a ship\'s paint renders in a worker of its own, and its job asks for no normal map');
    ok(!!shipAnswer && !shipAnswer.normal && bytes(shipAnswer) === bytes(answer), "so its answer carries none, whatever the recipe could choose (a normal map arriving on a hull's material would change its program)");

    // Through a character's customizer: the colour and the normal map both go on, as a render made here would put them.
    const mat = new THREE.MeshStandardMaterial({ name: 'shader/vest.sht', map: new THREE.Texture() });
    const cz = new Customizer(characters, { putsGlow: true });
    cz.materialsFor = (name, mesh) => (name === 'shader/vest.sht' && (mesh === undefined || mesh === 'vest_m_l0') ? [mat] : []);
    await cz.addSource(DIR);
    cz.set('vest_m_l0|/private/index_color_1', 2);
    await cz.settled();
    const data = (t: THREE.Texture | null) => ({ rgba: ((t?.image as { data?: Uint8Array } | undefined)?.data ?? []) as ArrayLike<number> });
    ok(bytes(data(mat.map)) === bytes(answer) && bytes(data(mat.normalMap)) === bytes(answer!.normal), "a character's customizer puts the worker's colour and its normal map on");
    cz.dispose();

    // The glowing piece through the worker: the split made there and put on here, exactly as on this thread.
    helmetChecks('rendered in the worker', await recolourHelmet(characters));
    ok(workersMade.length === 2, 'and every character render went to the one characters\' worker');
  } finally {
    delete (globalThis as unknown as { Worker?: unknown }).Worker;
  }
}

// ---------------------------------------------------------------- a loaded mesh is a recipe's mesh by its name, less the loader's suffix
{
  ok(isRecipeMesh('glove_l_m_l0', 'glove_l_m_l0') && !isRecipeMesh('glove_r_m_l0', 'glove_l_m_l0'), 'a mesh is its own recipe\'s and never its pair\'s');
  ok(isRecipeMesh('robe_b_m_l0_1', 'robe_b_m_l0') && isRecipeMesh('robe_b_m_l0_12', 'robe_b_m_l0') && recipeMeshOf('robe_b_m_l0_2') === 'robe_b_m_l0', "a mesh's second material onwards, suffixed by the loader, is still the recipe's mesh");
  ok(!isRecipeMesh('hum_m_head_l0', 'hum_m_head') && !isRecipeMesh('robe_b_m_l0', 'robe_b_m_l0_1') && recipeMeshOf('hum_m_head_l0') === 'hum_m_head_l0', 'a level of detail is not a suffix, and a bare mesh is not a suffixed one');
  // Character.load cannot run under node (a TypeScript parameter property among its imports), so its source is read:
  // the per-mesh filter, the worker and the glow are three lines there that no other check here would miss.
  const character = readFileSync(new URL('../../../src/player/character.ts', import.meta.url), 'utf8');
  ok(/if \(mesh !== undefined && !isRecipeMesh\(m\.name, mesh\)\) continue;/.test(character) && /customizer\.materialsFor = \(name, mesh\) => character\.materialsNamed\(name, mesh\);/.test(character), "a character answers a recipe's mesh with that mesh's materials alone, by this rule");
  ok(/const off = opts\.share \? null : opts\.renderOff === undefined \? characterRender : opts\.renderOff;/.test(character), "every character but a look built to share renders in the characters' worker unless told otherwise");
  ok(/new Customizer\(off, \{ putsGlow: !!off \}\)/.test(character), 'and puts on the glow the worker splits for it');
}

// ---------------------------------------------------------------- a render that comes back after its recipe was asked for again is not put
{
  const DIR = 'http://pack/stale/';
  const recipe = garment('cape_m_l0', 'shader/cape.sht');
  pack(DIR, [recipe]);
  const pending: { values: Values; resolve: (i: JobImg | null) => void }[] = [];
  const render: RecipeRender = (_r, values) => new Promise((resolve) => pending.push({ values, resolve }));
  const mat = new THREE.MeshStandardMaterial({ name: 'shader/cape.sht', map: new THREE.Texture() });
  const cz = new Customizer(render, { putsGlow: true });
  cz.materialsFor = (name) => (name === 'shader/cape.sht' ? [mat] : []);
  await cz.addSource(DIR);
  const key = 'cape_m_l0|/private/index_color_1';
  const marked = (n: number): JobImg => ({ width: 1, height: 1, rgba: Uint8Array.from([n, n, n, 255]) });
  cz.set(key, 1);
  for (let i = 0; i < 50 && !pending.length; i++) await new Promise((r) => setTimeout(r, 1));
  cz.set(key, 2);
  pending[0].resolve(marked(1));
  for (let i = 0; i < 50 && pending.length < 2; i++) await new Promise((r) => setTimeout(r, 1));
  const first = (mat.map?.image as { data?: Uint8Array } | undefined)?.data?.[0];
  ok(pending.length === 2 && first !== 1 && pending[1].values.get(key) === 2, 'the colour from before the newer pick is not put; the newer render is asked for');
  pending[1].resolve(marked(2));
  await cz.settled();
  ok((mat.map?.image as { data?: Uint8Array }).data?.[0] === 2 && cz.stats().staleDropped === 1, 'and the newer render is the one that goes on');
  // A render out in a worker when the character goes puts nothing.
  cz.set(key, 3);
  for (let i = 0; i < 50 && pending.length < 3; i++) await new Promise((r) => setTimeout(r, 1));
  const before = mat.map;
  cz.dispose();
  pending[2].resolve(marked(3));
  await new Promise((r) => setTimeout(r, 5));
  ok(mat.map === before, 'a render landing after its customizer was let go puts nothing');
}

// ---------------------------------------------------------------- the picker's rules
{
  ok(pickKind({ palette: DYE_PALETTE }) === 'dye' && pickKind({ palette: PALETTE, garment: true }) === 'garment', 'a dye of ours is a dye, and a worn piece\'s colour a garment\'s');
  ok(pickKind({ palette: 'palette/pc_hair_hum.pal' }) === 'hair' && pickKind({ palette: 'palette/wr_cloth_general.pal', hair: true }) === 'hair', 'a hair palette or a hairstyle\'s own colour is hair (the facial hair follows the hair)');
  ok(pickKind({ palette: 'palette/pc_eye_rod.pal' }) === 'eyes' && pickKind({ palette: 'palette/x.pal', row: 'color_eyes' }) === 'eyes', 'an eye palette, or the creator\'s eye row, is an eye colour');
  ok(['palette/pc_skin_twk.pal', 'palette/pc_lips_hum.pal', 'palette/pc_tat_zab.pal', 'palette/pc_horns_zab_b.pal', 'palette/pc_skin_twk_leccu.pal'].every((p) => pickKind({ palette: p }) === 'body'), 'skin, lips, markings, horns and lekku are the body\'s');
  ok(pickerTabs('garment').join() === 'own,garments,creator,all' && pickerTabs('hair').join() === 'own,garments,creator,all', 'a garment or hair colour offers every colour there is');
  ok(pickerTabs('body').join() === 'own' && pickerTabs('eyes').join() === 'own,eyes', 'a body colour its own palette alone, an eye colour its own and every species\' eyes');
  ok(pickerTabs('dye').join() === 'garments,creator,all' && openTab('dye') === 'all' && openTab('garment') === 'own' && openTab('eyes') === 'own', 'our dye opens on All garment colours, a palette row on its own');
  ok(garmentPaletteLabel('palette/wr_cloth_general.pal') === 'Cloth' && garmentPaletteLabel('palette/wr_warm_colors.pal') === 'Warm colours' && garmentPaletteLabel('palette/swamptrooper.pal') === 'Swamp trooper' && garmentPaletteLabel('palette/wr_new_armor.pal') === 'New armour', 'garment palettes are named by us from their files');
  ok(creatorPaletteLabel('pc_skin_twk_leccu') === "Skin tones (Twi'lek, lekku)" && creatorPaletteLabel('palette/pc_hair_rod_female.pal') === 'Hair (Rodian female)' && creatorPaletteLabel('pc_skin_ith_f') === 'Skin tones (Ithorian female)' && creatorPaletteLabel('pc_skin_wke') === 'Fur (Wookiee)' && creatorPaletteLabel('pc_horns_zab_b') === 'Horns (Zabrak)', 'creator palettes are named by family and species');
  const g = garmentPalettes({ [PALETTE]: [[1, 1, 1, 255], [1, 1, 1, 255], [2, 2, 2, 255]], 'palette/pc_hair_hum.pal': [[9, 9, 9, 255]], [DYE_PALETTE]: [[255, 255, 255, 0]], 'palette/white.pal': [[213, 213, 213, 255], [213, 213, 213, 255]] });
  ok(g.map((p) => p.label).join() === 'Cloth,White' && g[0].colors.length === 2 && g[1].colors.length === 1, 'the Garments tab is every garment palette, the largest first, its repeats once: never a creator palette or our dye');
  const sorted = sortColours([[200, 0, 0], [10, 10, 10], [0, 0, 200], [240, 240, 240], [90, 0, 0]]);
  ok(sorted.map((c) => c.join('.')).join(' ') === '10.10.10 240.240.240 90.0.0 200.0.0 0.0.200', 'browsing order: greys first, dark to light, then by hue, each hue dark to light');
  const folded = foldColours([[[100, 100, 100], [102, 99, 104]], [[100, 100, 100], [110, 100, 100]]], 4);
  ok(folded.length === 2, 'colours within four levels on every channel fold into one, and a colour two palettes share is one');
  ok(DYE_TUNE.cell === 10 && DYE_TUNE.allCell === 8 && DYE_TUNE.foldLevels === 4 && DYE_TUNE.maxHeight === 240, 'the tune is the design\'s');

  // What a swatch writes, tab by tab: the Own tab the index in the row's own palette (the creator's block from 0,
  // the More block from where the creator's colours end), every other tab the colour carried whole.
  const own = [[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0], [50, 0, 0]];
  const row = { colors: own, layout: { creation: 3, columns: 3, more: 2, moreColumns: 2 } };
  const source: PickerSource = { garments: [{ stem: 'wr_metal', label: 'Metal', colors: [[1, 2, 3], [4, 5, 6]] }], creator: [{ stem: 'pc_hair_hum', label: 'Hair (Human)', colors: [[7, 8, 9]] }], eyes: [{ stem: 'pc_eye_rod', label: 'r:eyes (Rodian)', colors: [[90, 0, 90]] }], all: [[100, 110, 120], [130, 140, 150]] };
  const ownBlocks = tabBlocks('own', row, source, 200);
  ok(ownBlocks.length === 2 && ownBlocks[0].colors.length === 3 && ownBlocks[0].cols === 3 && ownBlocks[1].label === 'More colours' && ownBlocks[1].cols === 2, "the Own tab is the creator's colours in their own columns, then the rest under them");
  ok(pickValue(ownBlocks[0], 0) === 0 && pickValue(ownBlocks[0], 2) === 2 && pickValue(ownBlocks[1], 0) === 3 && pickValue(ownBlocks[1], 1) === 4, "a pick on the Own tab writes the index in the row's own palette, the More block's counted on from the creator's");
  ok(pickValue(ownBlocks[0], 3) === null && pickValue(ownBlocks[1], 2) === null, 'past a block\'s last swatch nothing is picked');
  for (const tab of ['garments', 'creator', 'eyes', 'all'] as const) {
    const blocks = tabBlocks(tab, row, source, 200);
    const wrote = blocks.flatMap((b) => b.colors.map((_, i) => pickValue(b, i)));
    const want = blocks.flatMap((b) => b.colors.map((c) => rawColour(c[0], c[1], c[2])));
    ok(blocks.length > 0 && blocks.every((b) => b.base === null) && wrote.join() === want.join() && wrote.every((v) => v !== null && isRawColour(v)), `a pick on the ${tab} tab writes the colour carried whole, never an index (${wrote.length} swatches)`);
  }
  ok(tabBlocks('all', row, source, 200)[0].cols === Math.floor(200 / DYE_TUNE.allCell) && tabBlocks('garments', row, source, 0)[0].cols > 0, 'a block is as wide as the picker has room for, and has columns before it is on the page');

  // The Every species tab's word is the table's own for the eye row; with none in the table, the page's own word for an eye palette.
  const table = (label: string | null): CreatorTable => ({
    format: 1,
    source: 'test',
    species: { human_male: { groups: [], rows: [{ name: 'color_eyes', label, group: 'eyes', type: 'color', variables: ['index_color_2'] }] } },
    palettes: { pc_eye_hum: { creation: 2, columns: 2, master: 0, colors: [[1, 1, 1, 255], [2, 2, 2, 255]] }, pc_eye_rod: { creation: 1, columns: 1, master: 0, colors: [[3, 3, 3, 255]] }, pc_hair_hum: { creation: 1, columns: 1, master: 0, colors: [[4, 4, 4, 255]] } },
  });
  const said = eyePalettes(table('r:eyes')).map((e) => e.label);
  ok(said.join() === 'r:eyes (Human),r:eyes (Rodian)', `each species' eye palette under the table's own word for the row (${said.join(', ')})`);
  const fallback = eyePalettes(table(null)).map((e) => e.label);
  ok(fallback.join() === `${paletteFamily('pc_eye_hum')} (Human),${paletteFamily('pc_eye_rod')} (Rodian)`, "and with no word in the table, the page's own for an eye palette");
}

// ---------------------------------------------------------------- a worn piece's colours, a section a piece
{
  const pc = (key: string, mesh: string, palette = PALETTE): PackColour => ({ key, name: key.replace(/^.*\|/, ''), private: true, mesh, kind: 'palette', colors: COLOURS, default: 0, live: true, palette });
  const colours = [pc('robe_a_m_l0|/private/index_color_1', 'robe_a_m_l0'), pc('robe_b_m_l0|/private/index_color_1', 'robe_b_m_l0'), pc('robe_b_m_l0|/private/index_color_dye', 'robe_b_m_l0', DYE_PALETTE), pc('glove_m_l0|/private/index_color_1', 'glove_m_l0')];
  const parts = [
    { name: 'hum_m_body_l0', meshNames: ['hum_m_body_l0', 'hum_m_body_l0_1'], worn: true, body: true },
    { name: 'gloves_s01', meshNames: ['glove_m_l0'], worn: true, body: false },
    { name: 'robe_s32', meshNames: ['robe_a_m_l0', 'robe_b_m_l0_1'], worn: true, body: false },
  ];
  const items = [{ id: 'robe_s32', name: 'Jedi Robe', parts: [{ name: 'robe_a_m_l0' }] }, { id: 'shirt_s03', name: 'Shirt', parts: [{ name: 'shirt_s03_m_l0' }] }];
  const { sections, loose } = itemSections(colours, parts, (k) => catalogueName(items, k));
  ok(sections.map((s) => s.item).join() === 'gloves_s01,robe_s32' && !loose.length, "one section a worn piece, in the character's own order");
  const robe = sections[1];
  ok(robe.label === 'Jedi Robe' && sections[0].label === null && robe.mesh === 'robe_a_m_l0', "headed by the game's name for the piece, or by its mesh where the catalogue has none");
  ok(robe.rows.length === 2 && robe.rows[0].keys.join() === 'robe_a_m_l0|/private/index_color_1,robe_b_m_l0|/private/index_color_1', "a row a bare variable, and a pick writes every one of the piece's meshes' keys (a mesh loaded suffixed is still the piece's)");
  ok(robe.rows[1].palette === DYE_PALETTE && variableLabel({ name: robe.rows[1].name, palette: robe.rows[1].palette }) === 'Dye', 'our dye is a row of its own, called Dye');
  ok(catalogueName(items, 'shirt_s03_m_l0') === 'Shirt' && catalogueName(items, 'nothing') === null, "a species pack's own piece is named by the catalogue item it is");
}

// ---------------------------------------------------------------- what is converted on this machine
const ROOT = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));

{
  // Our dye on a real wardrobe recipe: at any index the piece as it was; under a colour, only what the mask lets through.
  const dir = join(ROOT, 'wardrobe', 'human_male');
  const czFile = join(dir, 'customize.json');
  if (!existsSync(czFile)) note('no human wardrobe on this machine, so our dye is not tried on a real recipe');
  else {
    const cz = JSON.parse(readFileSync(czFile, 'utf8')) as { recipes: (Recipe & { invented?: string })[]; palettes: Record<string, number[][]>; dye?: { variable: string } };
    const dyed = cz.recipes.filter((r) => r.invented === 'dye');
    const decoded = new Map<string, Img | null>();
    const load = (f: string | null): Img | null => {
      if (!f) return null;
      if (!decoded.has(f)) decoded.set(f, existsSync(join(dir, 'customize', f)) ? (decodePngSync(readFileSync(join(dir, 'customize', f))) as Img) : null);
      return decoded.get(f)!;
    };
    const keyOf = (r: Recipe) => `${r.mesh}|${cz.dye?.variable ?? '/private/index_color_dye'}`;
    // The mask is tried on a piece it covers in part, so "only masked texels change" says something: on a piece
    // whose mask covers it whole (the Snowtrooper's chest plate) every texel may change and the check would pass empty.
    const share = (r: Recipe): number => {
      const m = load(r.shader?.textures.DYEB ?? null);
      if (!m) return 0;
      let on = 0;
      for (let i = 3; i < m.rgba.length; i += 4) if (m.rgba[i] > 0) on++;
      return on / (m.width * m.height);
    };
    const pick = dyed.find((r) => share(r) > 0.1 && share(r) < 0.9);
    if (!pick) note('the human wardrobe carries no dye of ours on a piece its mask covers in part (converted before it): not tried');
    else {
      const key = keyOf(pick);
      const plain = renderRecipe(pick, new Map(), cz.palettes, load);
      const at = (v: number) => renderRecipe(pick, new Map([[key, v]]), cz.palettes, load);
      ok(!!plain && [0, 3, 11].every((v) => bytes(at(v)) === bytes(plain)), `${pick.mesh}: our dye at any index leaves the piece as it was`);
      const red = at(rawColour(200, 30, 30))!;
      const mask = load(pick.shader!.textures.DYEB)!;
      let changedUnmasked = 0;
      let changed = 0;
      const sx = mask.width / plain!.width;
      const sy = mask.height / plain!.height;
      for (let y = 0; y < plain!.height; y++) {
        for (let x = 0; x < plain!.width; x++) {
          const i = (y * plain!.width + x) * 4;
          const differs = red.rgba[i] !== plain!.rgba[i] || red.rgba[i + 1] !== plain!.rgba[i + 1] || red.rgba[i + 2] !== plain!.rgba[i + 2];
          if (!differs) continue;
          changed++;
          // The mask under this texel and its neighbours (the render samples between texels).
          const mx = Math.floor(x * sx);
          const my = Math.floor(y * sy);
          let any = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(mask.width - 1, Math.max(0, mx + dx));
            const yy = Math.min(mask.height - 1, Math.max(0, my + dy));
            any = Math.max(any, mask.rgba[(yy * mask.width + xx) * 4 + 3]);
          }
          if (any === 0) changedUnmasked++;
        }
      }
      ok(changed > 0 && changedUnmasked === 0, `${pick.mesh}: under a colour carried whole only masked texels change (${changed} changed, ${changedUnmasked} outside the mask, which covers ${(share(pick) * 100).toFixed(1)}% of it)`);
    }
    // The design's own check, a Snowtrooper's armour in any colour with the visor still black: the visor is the
    // helmet's (the chest plate's mask covers it whole), and every near-black texel of it is left as it was.
    const visor = dyed.find((r) => /^armor_snow_trooper_helmet_/.test(r.mesh));
    if (!visor) note('the human wardrobe has no dyed Snowtrooper helmet: the visor is not tried');
    else {
      const plain = renderRecipe(visor, new Map(), cz.palettes, load)!;
      let dark = 0;
      let moved = 0;
      for (const colour of [rawColour(200, 30, 30), rawColour(255, 255, 255), rawColour(30, 200, 60)]) {
        const dyedNow = renderRecipe(visor, new Map([[keyOf(visor), colour]]), cz.palettes, load)!;
        for (let i = 0; i < plain.rgba.length; i += 4) {
          if (Math.max(plain.rgba[i], plain.rgba[i + 1], plain.rgba[i + 2]) > 24) continue;
          dark++;
          if (dyedNow.rgba[i] !== plain.rgba[i] || dyedNow.rgba[i + 1] !== plain.rgba[i + 1] || dyedNow.rgba[i + 2] !== plain.rgba[i + 2]) moved++;
        }
      }
      ok(dark > 0 && moved === 0, `${visor.mesh}: red, white or green, the visor stays black (${dark / 3} near-black texels, ${moved} moved)`);
    }
    // The All grid of the human wardrobe: about the design's fifteen hundred, and no interface palette among the Garments.
    const garments = garmentPalettes(cz.palettes);
    const all = allGarmentColours(garments, cz.palettes);
    ok(garments.length >= 20 && garments.every((g) => !/^ui(_|$)/.test(g.stem)), `the Garments tab: ${garments.length} palettes, none of them the client's interface palettes`);
    ok(all.length > 1200 && all.length < 1700, `the All grid folds the garment colours to ${all.length} (the design measured about 1,500)`);
  }
}

{
  // Every race may take every eye colour: each species' eye row is read through a palette, which is what decodes a colour carried whole.
  const tableFile = join(ROOT, 'characters', 'customization.json');
  if (!existsSync(tableFile)) note('no creator table on this machine, so the eye colours are not read');
  else {
    const table = JSON.parse(readFileSync(tableFile, 'utf8')) as CreatorTable;
    const eyes = eyePalettes(table);
    // The table's own word for the eye row, read here and never written into this file.
    const word = Object.values(table.species).flatMap((s) => s.rows).find((r) => r.name === 'color_eyes' && r.label)?.label ?? null;
    ok(!!word && eyes.length === 9 && eyes.every((e) => e.label.startsWith(`${word} (`) && e.colors.length > 0), `the Every species tab: ${eyes.length} species' eye palettes, each under the table's own word for the eye row`);
    ok(creatorPalettes(table).every((p) => /^pc_/.test(p.stem)) && creatorPalettes(table).length >= 30, 'the Creator tab is every creator palette, by family and species');
    const without: string[] = [];
    const notPalette: string[] = [];
    let withRow = 0;
    let read = 0;
    for (const [id, s] of Object.entries(table.species)) {
      const row = s.rows.find((r) => r.name === 'color_eyes');
      if (!row) {
        without.push(id);
        continue;
      }
      const czFile = join(ROOT, 'characters', id, 'customize.json');
      if (!existsSync(czFile)) continue;
      withRow++;
      const cz = JSON.parse(readFileSync(czFile, 'utf8')) as { recipes: Recipe[] };
      const bare = (n: string) => n.replace(/^.*\//, '');
      let byPalette = false;
      for (const r of cz.recipes) {
        if (!/_head_/.test(r.mesh)) continue;
        const shaders = [r.shader, ...r.slots.flatMap((x) => x.blueprint.shaders)];
        // A palette factor or a blueprint's palette op is what `paletteColor` decodes; a choice or a raw factor is not.
        const viaPalette = shaders.some((sh) => (sh?.palettes ?? []).some((p) => row.variables.includes(bare(p.variable)))) || r.slots.some((x) => x.blueprint.prepare.some((op) => op.kind === 'palette' && row.variables.includes(bare(x.blueprint.variables[op.variable]?.name ?? ''))));
        const viaOther = shaders.some((sh) => (sh?.choices ?? []).some((c) => row.variables.includes(bare(c.variable)))) || r.slots.some((x) => x.blueprint.prepare.some((op) => op.kind !== 'palette' && 'variable' in op && row.variables.includes(bare(x.blueprint.variables[op.variable]?.name ?? ''))));
        if (viaOther) notPalette.push(`${id} ${r.mesh}`);
        if (viaPalette) byPalette = true;
      }
      if (byPalette) read++;
      else notPalette.push(`${id}: no head reads it`);
    }
    ok(withRow > 0 && read === withRow && notPalette.length === 0, `every species' eye colour is read on its head through a palette, so a colour carried whole reaches it (${read} of ${withRow} species${notPalette.length ? `; not: ${notPalette.join(', ')}` : ''})`);
    ok(without.sort().join() === 'ithorian_female,ithorian_male', `the species with no eye colour row take nothing new: ${without.join(', ')}`);
    // One head rendered: an eye colour carried whole changes the head, as an index does.
    const hm = join(ROOT, 'characters', 'human_male');
    if (existsSync(join(hm, 'customize.json'))) {
      const cz = JSON.parse(readFileSync(join(hm, 'customize.json'), 'utf8')) as { images: string; recipes: Recipe[]; palettes: Record<string, number[][]> };
      const head = cz.recipes.find((r) => /^hum_m_head_l0$/.test(r.mesh) && (r.shader?.palettes ?? []).some((p) => /pc_eye_hum/.test(p.palette)));
      if (head) {
        const load = (f: string | null): Img | null => (f && existsSync(join(hm, cz.images, f)) ? (decodePngSync(readFileSync(join(hm, cz.images, f))) as Img) : null);
        const eye = head.shader!.palettes.find((p) => /pc_eye_hum/.test(p.palette))!;
        const key = `${head.mesh}|${eye.variable}`;
        const t0 = Date.now();
        const a = renderRecipe(head, new Map([[key, 0]]), cz.palettes, load);
        const b = renderRecipe(head, new Map([[key, rawColour(255, 0, 255)]]), cz.palettes, load);
        ok(!!a && !!b && bytes(a) !== bytes(b), `a human's eyes take a colour carried whole (${Date.now() - t0} ms for two renders)`);
      }
    }
  }
}

{
  // `isRecipeMesh` takes a `_<digits>` off a loaded mesh's name as the loader's own suffix, which is right only while no
  // recipe names a mesh ending in one of its own: read over every pack a character's customizer reads (the species,
  // the wardrobes, the mobiles' own models and the wardrobes their looks are dressed from). A ship's is not: its
  // paint asks for materials by name alone.
  const files: string[] = [];
  for (const sub of ['characters', 'wardrobe', join('mobiles', 'models'), join('mobiles', 'wearables')]) {
    const base = join(ROOT, sub);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base, { withFileTypes: true })) if (d.isDirectory() && existsSync(join(base, d.name, 'customize.json'))) files.push(join(base, d.name, 'customize.json'));
  }
  if (!files.length) note('no converted customize.json on this machine, so the recipes\' mesh names are not read');
  else {
    let recipes = 0;
    const suffixed: string[] = [];
    for (const f of files) {
      const cz = JSON.parse(readFileSync(f, 'utf8')) as { recipes?: Recipe[] };
      for (const r of cz.recipes ?? []) {
        recipes++;
        if (recipeMeshOf(r.mesh) !== r.mesh) suffixed.push(r.mesh);
      }
    }
    ok(recipes > 0 && suffixed.length === 0, `no recipe names a mesh ending in a _<digits> of its own (${recipes} recipes over ${files.length} packs${suffixed.length ? `; these do: ${suffixed.slice(0, 8).join(', ')}` : ''})`);
  }
}

(globalThis as unknown as { fetch: unknown }).fetch = realFetch;
console.log(`\ndyeRender: ${passed} checks passed`);
