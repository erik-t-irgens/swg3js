// A shared look's renders made in the characters' worker (the performance pass's second wave: `Customizer.shareRender`,
// src/player/customizer.ts), checked under node with the game's own code: the renderer `makeRecipeRender` makes, over a
// stand-in Worker that runs a fresh copy of the real worker module (recipeWorker.worker.ts, its own `self`, a message
// reaching it cloned and its answer coming back with its buffers handed over, as dyeRender.test.ts drives it), so the
// hashes the share keys pictures by are the ones the worker itself makes. Pinned: what it makes is the very picture
// and the very content key the main thread's shared path makes; a look whose shader has a normal map and glows through
// a mask comes out with the same colour, glow and normal map either way, each in its own colour space and slot, from
// one ask of the worker, each carrying the hash of its own pixels; two looks of one colouring built through the share
// wear one texture between them and the renderer is asked once, while the main thread's own render (`colourRender`)
// is never called; a third colouring is its own texture; and a customizer that renders elsewhere already refuses a
// share outright, since it would take the private branch.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Img, Pass, Recipe, ShaderDef } from '../../../src/player/texrender.ts';
import { Customizer, type RecipeRender } from '../../../src/player/customizer.ts';
import { makeRecipeRender } from '../../../src/player/recipeWorker.ts';
import { hashPixels } from '../../../src/player/bytesHash.ts';
import type { PaintRecipe } from '../../../src/vehicles/paintJob.ts';
import { CONTENT_HASH, LookShare, contentKey } from '../../../src/world/mobiles/lookShare.ts';
import { encodePng } from '../png.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// One palette colour filling a 4 by 4 picture, chosen by the mesh's own variable (lookShare.test.ts's recipe).
const PALETTE = 'palette/test.pal';
const COLOURS = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
];
const shader: ShaderDef = {
  effect: null,
  passes: [{ alphaBlend: false, blendOp: 0, blendSrc: 0, blendDst: 0, alphaTest: false, alphaRefTag: null, alphaFunc: 0, writeMask: 15, tfactorTag: 'TFAC', stages: [{ colorOp: 2, colorArgs: [[0, 0, 0], [0, 0, 0], [5, 0, 0]], alphaOp: 2, alphaArgs: [[0, 0, 0], [0, 0, 0], [5, 0, 0]], result: 0, textureTag: 'NONE', coordSetTag: 'NONE' }] }],
  textures: {},
  addresses: {},
  coordSets: {},
  tfactors: {},
  alphaRefs: {},
  choices: [],
  palettes: [],
};
const RECIPE: Recipe = {
  mesh: 'shirt_m_l0',
  material: 'shader/shirt.sht',
  kind: 'render',
  baseTag: 'MAIN',
  shader: null,
  slots: [
    {
      tag: 'MAIN',
      file: 'shirt_m_l0.trt',
      blueprint: {
        width: 4,
        height: 4,
        camera: 4,
        shaders: [shader],
        textures: [],
        vertexBuffers: [[[0, 0, 0xffffffff, 0, 0], [4, 0, 0xffffffff, 1, 0], [4, 4, 0xffffffff, 1, 1], [0, 4, 0xffffffff, 0, 1]]],
        uvSets: [1],
        indexBuffers: [],
        commands: [{ kind: 'draw', shader: 0, primitives: [{ kind: 'fan', vb: 0 }] }],
        prepare: [{ kind: 'palette', shader: 0, tag: 'TFAC', palette: PALETTE, variable: 0 }],
        variables: [{ name: '/private/index_color_1', private: true, kind: 'palette', default: 0, palette: PALETTE }],
      },
    },
  ],
};
const COLOUR = 'shirt_m_l0|/private/index_color_1';
const DIR = 'http://pack/wardrobe/human_male/';

// A worn piece with a normal map that glows through a mask in another texture's alpha (the shape of the two Ithorian
// GCW helmets, as dyeRender.test.ts makes it up): a bake over its picture, a palette on the shader, a plain NRML map.
const GLOW_PALETTE = 'palette/test_glow.pal';
const GLOW_COLOURS = [
  [255, 255, 255, 255],
  [255, 64, 32, 255],
];
const img = (w: number, h: number, texels: number[][]): Img => ({ width: w, height: h, rgba: Uint8Array.from(texels.flat()) });
const HELMET_FILES: Record<string, Img> = {
  'helmet_main.png': img(2, 2, [[200, 180, 160, 255], [120, 120, 120, 255], [60, 90, 200, 255], [250, 250, 250, 255]]),
  'helmet_emis.png': img(2, 2, [[0, 0, 0, 255], [0, 0, 0, 128], [0, 0, 0, 255], [0, 0, 0, 0]]),
  'helmet_nrml.png': img(2, 2, [[128, 128, 255, 255], [140, 120, 250, 255], [100, 160, 240, 255], [128, 128, 255, 255]]),
};
const HELMET_PASS: Pass = { alphaBlend: false, blendOp: 0, blendSrc: 4, blendDst: 5, alphaTest: false, alphaRefTag: null, alphaFunc: 8, writeMask: 15, tfactorTag: 'TFAC', stages: [{ colorOp: 3, colorArgs: [[0, 0, 0], [4, 0, 0], [5, 0, 0]], alphaOp: 2, alphaArgs: [[0, 0, 0], [0, 0, 0], [4, 0, 0]], result: 1, textureTag: 'MAIN', coordSetTag: 'MAIN' } as never] };
const HELMET: PaintRecipe = {
  mesh: 'helmet_m_l0',
  material: 'shader/helmet.sht',
  kind: 'bake',
  baseTag: 'MAIN',
  shader: {
    effect: 'effect/h_color2w_x.eft',
    passes: [HELMET_PASS],
    textures: { MAIN: 'helmet_main.png', EMIS: 'helmet_emis.png', NRML: 'helmet_nrml.png' },
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
const HELMET_COLOUR = 'helmet_m_l0|/private/index_color_1';
const HELMET_DIR = 'http://pack/wardrobe/ithorian_male/';

// The files a customizer and the worker read, through a stand-in for `fetch`.
const served = new Map<string, Uint8Array | string>();
served.set(`${DIR}customize.json`, JSON.stringify({ images: 'customize/', recipes: [RECIPE], palettes: { [PALETTE]: COLOURS } }));
served.set(`${HELMET_DIR}customize.json`, JSON.stringify({ images: 'customize/', recipes: [HELMET], palettes: { [GLOW_PALETTE]: GLOW_COLOURS } }));
for (const [name, i] of Object.entries(HELMET_FILES)) served.set(`${HELMET_DIR}customize/${name}`, encodePng(i.width, i.height, i.rgba));
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const body = served.get(String(url));
  if (body === undefined) return new Response('', { status: 404 });
  return new Response(body, { headers: { 'content-type': typeof body === 'string' ? 'application/json' : 'image/png' } });
};

// The stand-in Worker: each one made runs a fresh copy of the real worker module, as a browser runs it.
interface FakeScope {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}
const posted: Record<string, unknown>[] = [];
const replies: Record<string, unknown>[] = [];
let workers = 0;
let workerChain: Promise<unknown> = Promise.resolve();
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  private readonly ready: Promise<FakeScope>;
  constructor(url: URL) {
    const n = ++workers;
    const scope: FakeScope = {
      postMessage: (m, transfer = []) => {
        // A copy of what the worker posted, read before its buffers are handed over (which empties them here).
        replies.push(structuredClone(m) as Record<string, unknown>);
        const data = structuredClone(m, { transfer });
        setTimeout(() => this.onmessage?.({ data }), 0);
      },
      onmessage: null,
    };
    this.ready = (workerChain = workerChain.then(async () => {
      (globalThis as unknown as { self: unknown }).self = scope;
      await import(`${url.href}?shared=${n}`);
      return scope;
    })) as Promise<FakeScope>;
  }
  postMessage(m: Record<string, unknown>): void {
    posted.push(m);
    const data = structuredClone(m);
    void this.ready.then((scope) => scope.onmessage?.({ data }));
  }
  terminate(): void {}
}
(globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;

// The characters' renderer, its worker the real module behind the stand-in, counted.
const renderer = makeRecipeRender({ name: 'sharedRender test', cacheMB: 8, withNormal: true });
let asked = 0;
let askedWithHash = 0;
const counted: RecipeRender = (r, values, palettes, dir, opts) => {
  asked++;
  if (opts?.hash) askedWithHash++;
  return renderer(r, values, palettes, dir, opts);
};

let mainRenders = 0;
/**
 * A customizer through `store`'s hold over one material, its renders made by `off` when given (else on this thread), its
 * own render counted. `glowMap` gives the material a glow map as a glowing piece's GLB does, which is what splits it.
 */
async function look(store: LookShare, value: number, off: RecipeRender | null, opts: { dir?: string; recipe?: Recipe; key?: string; glowMap?: boolean } = {}): Promise<{ mat: THREE.MeshStandardMaterial; cz: Customizer }> {
  const recipe = opts.recipe ?? RECIPE;
  const mat = new THREE.MeshStandardMaterial({ name: recipe.material, ...(opts.glowMap ? { emissiveMap: new THREE.Texture() } : {}) });
  const cz = new Customizer();
  cz.share = store.hold(opts.dir ?? DIR);
  cz.shareRender = off;
  const own = cz as unknown as { colourRender: (...a: unknown[]) => unknown };
  const real = own.colourRender.bind(cz);
  own.colourRender = (...a: unknown[]) => {
    mainRenders++;
    return real(...a);
  };
  cz.materialsFor = (name, mesh) => (name === mat.name && (mesh === undefined || mesh === recipe.mesh) ? [mat] : []);
  ok(await cz.addSource(opts.dir ?? DIR), 'the recipes load');
  cz.setAll({ [opts.key ?? COLOUR]: value });
  await cz.settled();
  return { mat, cz };
}
const hex = (t: THREE.Texture | null): string => {
  const d = (t?.image as { data?: Uint8Array } | undefined)?.data;
  return d ? Buffer.from(d).toString('hex') : '';
};
const pixelsOf = (t: THREE.Texture | null): Uint8Array => ((t?.image as { data?: Uint8Array } | undefined)?.data ?? new Uint8Array(0)) as Uint8Array;
const hashed = (t: THREE.Texture | null): boolean => !!t && typeof t.userData[CONTENT_HASH] === 'string' && t.userData[CONTENT_HASH] === hashPixels(pixelsOf(t));

// ---- 1. The worker's picture and hash are the main thread's. ----
{
  const mainStore = new LookShare();
  const onThread = await look(mainStore, 1, null);
  const ranHere = mainRenders;
  const askedHere = asked;
  mainRenders = 0;
  const workerStore = new LookShare();
  const offThread = await look(workerStore, 1, counted);
  const a = onThread.mat.map!;
  const b = offThread.mat.map!;
  ok(ranHere === 1 && askedHere === 0, "the main thread's shared path renders the look itself and asks no renderer");
  ok(renderer.status().where === 'worker' && workers === 1, 'the renderer ran its job in its worker (the real module, behind the stand-in)');
  ok(mainRenders === 0 && asked === 1 && askedWithHash === 1, 'through the worker the main thread renders nothing, and the worker is asked once, for its hash as well');
  const job = posted.find((m) => m.id !== undefined);
  ok(!!job && job.hash === true && job.normal === true, "the job posted to the worker asks for the hash, and a character's for the normal map");
  ok(hex(a) !== '' && hex(a) === hex(b), 'the picture the worker makes is byte for byte the one the main thread makes');
  const reply = replies.find((m) => m.rgba !== undefined);
  ok(!!reply && typeof reply.hash === 'string' && reply.hash === hashPixels(reply.rgba as Uint8Array), 'the worker hashes the very buffer it posts');
  ok(hashed(b), "the worker's texture carries the hash made where it was rendered, which is the hash of its pixels");
  ok(a.userData[CONTENT_HASH] === undefined && contentKey(a) === contentKey(b), "and its content key is the one the main thread works out by reading the pixels again");
  ok(b.colorSpace === a.colorSpace && b.wrapS === a.wrapS && b.minFilter === a.minFilter && b.anisotropy === a.anisotropy && b.flipY === a.flipY, 'drawn exactly as the texture made on this thread is');
}

// ---- 1b. A piece with a normal map that glows: the colour, the glow and the normal map, each in its own slot. ----
{
  asked = 0;
  mainRenders = 0;
  const onThread = await look(new LookShare(), 1, null, { dir: HELMET_DIR, recipe: HELMET, key: HELMET_COLOUR, glowMap: true });
  const ranHere = mainRenders;
  mainRenders = 0;
  replies.length = 0;
  const offThread = await look(new LookShare(), 1, counted, { dir: HELMET_DIR, recipe: HELMET, key: HELMET_COLOUR, glowMap: true });
  const m = onThread.mat;
  const w = offThread.mat;
  ok(ranHere >= 1 && mainRenders === 0 && asked === 1, `through the worker the colour, the glow and the normal map come from one ask (${asked}), none rendered on this thread`);
  ok(hex(w.map) !== '' && hex(w.map) === hex(m.map), 'the lit colour is byte for byte the main thread\'s');
  ok(hex(w.emissiveMap) !== '' && hex(w.emissiveMap) === hex(m.emissiveMap) && hex(w.emissiveMap) !== hex(w.map), 'the glow goes on the glow map, byte for byte the main thread\'s, and is not the colour');
  ok(hex(w.normalMap) !== '' && hex(w.normalMap) === hex(m.normalMap) && hex(w.normalMap) !== hex(w.emissiveMap), 'the normal map goes on the normal map, byte for byte the main thread\'s, and is not the glow');
  ok(w.map!.colorSpace === THREE.SRGBColorSpace && w.emissiveMap!.colorSpace === THREE.SRGBColorSpace && w.normalMap!.colorSpace === THREE.NoColorSpace, 'the colour and the glow in sRGB, the normal map as it stands');
  ok(w.map!.colorSpace === m.map!.colorSpace && w.emissiveMap!.colorSpace === m.emissiveMap!.colorSpace && w.normalMap!.colorSpace === m.normalMap!.colorSpace, 'each in the colour space the main thread gives it');
  ok(hashed(w.map) && hashed(w.emissiveMap) && hashed(w.normalMap), 'and each carries the hash of its own pixels, made in the worker');
  const reply = replies.find((r) => r.rgba !== undefined) as { hash?: string; rgba: Uint8Array; emis?: { hash?: string; rgba: Uint8Array }; normal?: { hash?: string; rgba: Uint8Array } } | undefined;
  ok(!!reply?.emis && !!reply.normal && reply.hash === hashPixels(reply.rgba) && reply.emis.hash === hashPixels(reply.emis.rgba) && reply.normal.hash === hashPixels(reply.normal.rgba), "the worker hashes the colour, the glow and the normal map it posts, each its own buffer's");
}

// ---- 2. Two looks of one colouring: one render between them, through the worker. ----
{
  asked = 0;
  mainRenders = 0;
  const store = new LookShare();
  const first = await look(store, 1, counted);
  const second = await look(store, 1, counted);
  ok(first.mat.map !== null && second.mat.map === first.mat.map, 'two looks of one colouring built through the share wear one texture');
  ok(asked === 1, 'and the worker was asked once between them');
  ok(mainRenders === 0, "while the main thread's own render was never called");
  const third = await look(store, 2, counted);
  ok(third.mat.map !== first.mat.map && asked === 2, 'a third colouring is a texture of its own, asked of the worker in its turn');
  const d = (third.mat.map!.image as { data: Uint8Array }).data;
  ok([d[0], d[1], d[2], d[3]].join() === COLOURS[2].join(), 'in its own colour');
  ok(store.stats().kinds.render.n === 2, 'two renders kept for three looks');
}

// ---- 3. A look that renders elsewhere cannot share. ----
{
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a.map(String).join(' '));
  try {
    const cz = new Customizer(counted, { putsGlow: true });
    cz.share = new LookShare().hold(DIR);
    ok(cz.share === null, 'a customizer that renders elsewhere refuses a share (it would take the private branch and never reach it)');
    ok(warned.length === 1 && /cannot share/.test(warned[0]), 'and says so once');
    const plain = new Customizer();
    const hold = new LookShare().hold(DIR);
    plain.share = hold;
    ok(plain.share === hold, 'one that renders here takes it, as before');
  } finally {
    console.warn = warn;
  }
}

console.log(`\n${passed} checks passed`);
