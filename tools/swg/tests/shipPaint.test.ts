// A ship's paint at run time (src/vehicles/shipPaint.ts with the customizer, src/vehicles/paintJob.ts,
// src/vehicles/glowSplit.ts): copies only for custom paint, prepared before they are worn, renders that land
// as they come and never after the paint changed course, the glow split the converter makes, and the glow
// map made as the customizer makes a map. A fake renderer and a stubbed fetch; no pack is read.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ShipPaint, type PaintHooks } from '../../../src/vehicles/shipPaint.ts';
import { maskOf, splitGlow } from '../../../src/vehicles/glowSplit.ts';
import { paintFiles, runPaintJob, ImageCache, type PaintImg, type PaintRecipe } from '../../../src/vehicles/paintJob.ts';
import type { Img, Pass, Recipe, ShaderDef, Values } from '../../../src/player/texrender.ts';
import type { FitPaint } from '../../../src/vehicles/shipFit.ts';
import { maskOf as convMaskOf, splitGlow as convSplitGlow } from '../surface.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await tick();
  assert.ok(cond(), `timed out waiting: ${what}`);
}

// --- 0: the glow split, byte for byte the converter's -----------------------------------------------------------------
{
  const glowTexels = [51, 51, 51, 0, 128, 128, 128, 128, 255, 255, 255, 255, 188, 188, 188, 128];
  const img = { width: 2, height: 2, rgba: Uint8Array.from(glowTexels) };
  const rgbMask = { width: 1, height: 1, rgba: Uint8Array.from([10, 200, 30, 0]) };
  let same = true;
  for (const [mask, channel] of [[img, 'a'], [rgbMask, 'rgb']] as const) {
    const a = maskOf(img, mask, channel)!;
    const b = convMaskOf(img, mask, channel) as Float32Array;
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) same = false;
    for (const keep of [false, true]) {
      const x = splitGlow(img, a, keep);
      const y = convSplitGlow(img, b, keep) as { lit: Img; emis: Img };
      if (!x.lit.rgba.every((v, i) => v === y.lit.rgba[i]) || !x.emis.rgba.every((v, i) => v === y.emis.rgba[i])) same = false;
    }
  }
  ok(same, "the glow split: maskOf and splitGlow match surface.mjs byte for byte on the converter's 2x2 fixture (alpha and rgb masks, alpha kept or not)");
  ok(maskOf(img, { width: 2, height: 2, rgba: new Uint8Array(16) }, 'a') === null && convMaskOf(img, { width: 2, height: 2, rgba: new Uint8Array(16) }, 'a') === null, 'the glow split: an empty mask is null in both');
}

// --- fixtures --------------------------------------------------------------------------------------------

/** A pass that copies MAIN (colour and alpha) straight through. */
const copyMain: Pass = { alphaBlend: false, blendOp: 0, blendSrc: 1, blendDst: 0, alphaTest: false, alphaRefTag: null, alphaFunc: 7, writeMask: 15, tfactorTag: null, stages: [{ colorOp: 1, colorArgs: [[0, 0, 0], [4, 0, 0], [0, 0, 0]], alphaOp: 1, alphaArgs: [[0, 0, 0], [4, 0, 0], [0, 0, 0]], result: 0, textureTag: 'MAIN', coordSetTag: '' }] };
function shader(choices: ShaderDef['choices'], palettes: ShaderDef['palettes'], textures: Record<string, string> = {}): ShaderDef {
  return { effect: 'effect/h_color2w_specmap_cbmp.eft', passes: [copyMain], textures, addresses: {}, coordSets: {}, tfactors: {}, alphaRefs: {}, choices, palettes };
}
const PAL = 'palette/starships_general.pal';
const recipeHull: PaintRecipe = {
  mesh: 'ship',
  material: 'shader/hull.sht',
  kind: 'bake',
  baseTag: 'MAIN',
  shader: shader([{ tag: 'MAIN', variable: 'index_texture_1', private: false, default: 0, files: ['hull_a.png', 'hull_b.png'] }], [{ tag: 'MAIN', palette: PAL, variable: 'index_color_1', private: false, default: 40 }], { CNRM: 'hull_n.png' }),
  slots: [],
  glow: { maskTag: 'MAIN', channel: 'a', keepAlpha: false },
  staticMain: 'hull_static.png',
};
const recipeWing: PaintRecipe = { mesh: 'ship', material: 'shader/wing.sht', kind: 'bake', baseTag: 'MAIN', shader: shader([], [{ tag: 'MAIN', palette: PAL, variable: 'index_color_2', private: false, default: 13 }], { MAIN: 'wing.png' }), slots: [] };
const recipeEngine: PaintRecipe = { mesh: 'ship', material: 'shader/engine.sht', kind: 'bake', baseTag: 'MAIN', shader: shader([{ tag: 'MAIN', variable: 'index_texture_1', private: false, default: 0, files: ['eng_a.png'] }], []), slots: [] };
const customize = { images: 'customize/', recipes: [recipeHull, recipeWing, recipeEngine], palettes: { [PAL]: Array.from({ length: 64 }, (_, i) => [i * 4, 0, 0, 255]) } };
(globalThis as { fetch: unknown }).fetch = async (url: string) => {
  if (String(url).endsWith('customize.json')) return { ok: true, headers: { get: () => 'application/json' }, json: async () => customize };
  return { ok: false, headers: { get: () => '' }, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) };
};

const paint: FitPaint = {
  shaders: ['shader/hull.sht', 'shader/wing.sht', 'shader/engine.sht'],
  variables: [
    { name: 'index_texture_1', kind: 'index', count: 2, fewest: 1, default: 0 },
    { name: 'index_color_1', kind: 'palette', palette: PAL, size: 64, default: 40 },
    { name: 'index_color_2', kind: 'palette', palette: PAL, size: 64, default: 13 },
  ],
};
const img2 = (v: number): Img => ({ width: 2, height: 2, rgba: new Uint8Array(16).fill(v) });

/** A hull: one mesh on the hull shader (with a glow map), one on the wing shader, one on something else. */
function ship() {
  const hullMat = new THREE.MeshStandardMaterial({ name: 'shader/hull.sht', map: new THREE.Texture(), emissiveMap: new THREE.Texture() });
  const wingMat = new THREE.MeshStandardMaterial({ name: 'shader/wing.sht', map: new THREE.Texture() });
  wingMat.userData.dry = true;
  const glassMat = new THREE.MeshStandardMaterial({ name: 'shader/glass.sht' });
  const geo = new THREE.BoxGeometry();
  const hull = new THREE.Mesh(geo, hullMat);
  const wing = new THREE.Mesh(geo, wingMat);
  const glass = new THREE.Mesh(geo, glassMat);
  const root = new THREE.Group();
  root.add(hull, wing, glass);
  return { root, hull, wing, glass, hullMat, wingMat, glassMat };
}

interface Rig {
  hooks: PaintHooks;
  renders: { material: string; values: Values; resolve: (img: PaintImg | null) => void }[];
  prepared: THREE.Object3D[][];
  forgotten: THREE.Material[];
  auto: boolean;
}
function rig(onPrepare?: (roots: THREE.Object3D[]) => void): Rig {
  const r: Rig = {
    renders: [],
    prepared: [],
    forgotten: [],
    auto: true,
    hooks: {
      prepare: async (roots) => {
        r.prepared.push(roots);
        onPrepare?.(roots);
      },
      forget: (m) => r.forgotten.push(...m),
      render: (recipe: Recipe, values: Values) =>
        new Promise<PaintImg | null>((resolve) => {
          const glow = !!(recipe as PaintRecipe).glow;
          const out = (): PaintImg => ({ ...img2(100 + (values.get('index_color_1') ?? 0)), ...(glow ? { emis: img2(7) } : {}) });
          r.renders.push({ material: recipe.material, values, resolve: (img) => resolve(img) });
          if (r.auto) resolve(out());
          else r.renders[r.renders.length - 1].resolve = (img) => resolve(img === undefined ? out() : img);
        }),
    },
  };
  return r;
}
let dirs = 0;
const dir = () => `/pack${dirs++}/ships/`;

// --- 1: stock values ------------------------------------------------------------------------------------
{
  const s = ship();
  const r = rig();
  const p = new ShipPaint(paint, dir(), r.hooks);
  p.track(s.root);
  await p.apply({ index_texture_1: 0, index_color_1: 40, index_color_2: 13 });
  ok(!p.custom && p.materials.length === 0 && r.prepared.length === 0 && r.renders.length === 0 && s.hull.material === s.hullMat, '1: stock values make no copies and render nothing; the meshes keep the GLB materials');
}

// --- 2: custom values -------------------------------------------------------------------------------------
{
  const s = ship();
  let wornDuringPrepare = true;
  let copiesInPrepare = 0;
  const r = rig((roots) => {
    wornDuringPrepare = s.hull.material !== s.hullMat;
    roots[0].traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && m !== s.hullMat && m !== s.wingMat && (m.name === 'shader/hull.sht' || m.name === 'shader/wing.sht')) copiesInPrepare++;
    });
  });
  const p = new ShipPaint(paint, dir(), r.hooks);
  p.track(s.root);
  await p.apply({ index_texture_1: 1, index_color_1: 20 });
  const hullCopy = s.hull.material as THREE.MeshStandardMaterial;
  const wingCopy = s.wing.material as THREE.MeshStandardMaterial;
  ok(p.materials.length === 2 && copiesInPrepare === 2 && !wornDuringPrepare, '2: copies are made once per source and prepared (on stand-ins) before they go on any mesh');
  ok(r.renders.length === 2 && r.renders.every((x) => x.values.get('index_texture_1') === 1), '2: the renderer is asked for each paint recipe, with the values');
  ok(p.custom && hullCopy !== s.hullMat && hullCopy.name === 'shader/hull.sht' && wingCopy.userData.dry === true && s.glass.material === s.glassMat, '2: the meshes wear the copies after apply resolves (userData kept), and a mesh without a paint shader is untouched');
  ok((hullCopy.map as THREE.DataTexture).isDataTexture && (wingCopy.map as THREE.DataTexture).isDataTexture && s.hullMat.map !== hullCopy.map, "2: the copies' maps are the renders; the sources keep theirs");
  ok(hullCopy.normalMap === null && s.hullMat.normalMap === null, '2: no normal map is rendered off the main thread (the recipe has a CNRM)');
  await p.settled(100);
  ok(true, '2: settled() resolves');
  // The glow map, made as the customizer makes a map.
  const emis = hullCopy.emissiveMap as THREE.DataTexture;
  ok(
    emis.isDataTexture && emis !== s.hullMat.emissiveMap && emis.wrapS === THREE.RepeatWrapping && emis.wrapT === THREE.RepeatWrapping && emis.minFilter === THREE.LinearMipmapLinearFilter && emis.magFilter === THREE.LinearFilter && emis.generateMipmaps === true && emis.anisotropy === 4 && emis.colorSpace === THREE.SRGBColorSpace && emis.flipY === false && emis.channel === 0,
    'the glow map: the emissiveMap set has exactly the customizer map\'s sampler settings',
  );
  ok((emis.image.data as Uint8Array)[0] === 7 && wingCopy.emissiveMap === null, 'the glow map: the glow goes on the glowing shader\'s copy only (never added to one without a glow map)');
  // 5: custom to custom, one value changed: only the recipes reading it render.
  const before = r.renders.length;
  await p.apply({ index_texture_1: 1, index_color_1: 20, index_color_2: 30 });
  ok(r.renders.length === before + 1 && r.renders[r.renders.length - 1].material === 'shader/wing.sht', '5: custom to custom with one value changed renders only the recipe reading it');
  await p.apply({ index_texture_1: 1, index_color_1: 20, index_color_2: 30 });
  ok(r.renders.length === before + 1, '5: the same values again render nothing');

  // 3: a part tracked while custom.
  const engMat = new THREE.MeshStandardMaterial({ name: 'shader/engine.sht', map: new THREE.Texture() });
  const hullMat2 = new THREE.MeshStandardMaterial({ name: 'shader/hull.sht', map: new THREE.Texture(), emissiveMap: new THREE.Texture() });
  const engine = new THREE.Group();
  const engMesh = new THREE.Mesh(new THREE.BoxGeometry(), engMat);
  const nacelle = new THREE.Mesh(new THREE.BoxGeometry(), hullMat2);
  engine.add(engMesh, nacelle);
  const rendersBefore = r.renders.length;
  p.track(engine);
  const nacelleCopy = nacelle.material as THREE.MeshStandardMaterial;
  ok(nacelleCopy !== hullMat2 && nacelleCopy.map === hullCopy.map && nacelleCopy.emissiveMap === hullCopy.emissiveMap, '3: a new part on an already-rendered shader wears a copy with its texture and glow at once');
  ok(engMesh.material !== engMat, '3: a new part on a shader not rendered yet wears its copy at once (before its prepare)');
  await p.settled(500);
  ok(r.renders.length === rendersBefore + 1 && r.renders[r.renders.length - 1].material === 'shader/engine.sht', '3: only the unrendered recipe is queued and rendered');
  ok(((engMesh.material as THREE.MeshStandardMaterial).map as THREE.DataTexture).isDataTexture, '3: its copy gets the texture');
  // 6: untrack a part whose shader nothing else wears.
  const engCopy = engMesh.material as THREE.Material;
  let disposed = false;
  engCopy.addEventListener('dispose', () => (disposed = true));
  p.untrack(engine);
  ok(r.forgotten.includes(engCopy) && disposed && !p.materials.includes(engCopy), '6: untrack of a part whose shader nothing else wears forgets and disposes that copy');
  ok(p.materials.includes(hullCopy), '6: a copy still worn elsewhere stays');
  // Back to stock: every source back, every copy forgotten.
  const all = [...p.materials];
  await p.apply({});
  ok(!p.custom && s.hull.material === s.hullMat && s.wing.material === s.wingMat && all.every((m) => r.forgotten.includes(m)) && p.materials.length === 0, 'stock again: the sources back on, the copies forgotten');
  p.dispose();
}

// --- 4: the race with stock (a stale render sets neither map nor emissiveMap) -------------------------
{
  const s = ship();
  const r = rig();
  r.auto = false;
  const p = new ShipPaint(paint, dir(), r.hooks);
  p.track(s.root);
  const first = p.apply({ index_color_1: 20 }, 5000);
  await until(() => r.renders.length >= 1, 'the first render asked for');
  const copies = [...p.materials];
  const hullCopy = copies.find((m) => m.name === 'shader/hull.sht') as THREE.MeshStandardMaterial;
  const mapBefore = hullCopy.map;
  const emisBefore = hullCopy.emissiveMap;
  await p.apply({});
  for (const x of r.renders) x.resolve(undefined as unknown as PaintImg);
  await first;
  await tick();
  ok(s.hull.material === s.hullMat && s.wing.material === s.wingMat && !p.custom, '4: apply(custom) then apply(stock) mid-render: the meshes wear the sources');
  ok(copies.length === 2 && copies.every((m) => r.forgotten.includes(m)), '4: forget received every copy');
  ok(hullCopy.map === mapBefore && hullCopy.emissiveMap === emisBefore, 'a render from before the paint went back to stock set neither map nor emissiveMap');
  for (let i = 0; i < 5; i++) await tick();
  ok(r.renders.length === 1, `the dropped customizer asks for nothing after the render it had in hand (its queue is cleared: ${r.renders.length} asked)`);
}

// --- 3b: a part tracked while custom, on a hull none of whose meshes wear a paint shader --------------------------
{
  const glassMat = new THREE.MeshStandardMaterial({ name: 'shader/glass.sht' });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), glassMat));
  const r = rig();
  const p = new ShipPaint(paint, dir(), r.hooks);
  p.track(root);
  await p.apply({ index_color_1: 20 });
  ok(p.custom && p.materials.length === 0, 'custom paint on a hull with no paint mesh yet: custom, no copies');
  const engMat = new THREE.MeshStandardMaterial({ name: 'shader/engine.sht', map: new THREE.Texture() });
  const engMesh = new THREE.Mesh(new THREE.BoxGeometry(), engMat);
  p.track(engMesh);
  ok(engMesh.material !== engMat && p.materials.length === 1, 'a part tracked then still gets its copy (the paint is custom, though it had no copies)');
  await p.settled(500);
  ok(((engMesh.material as THREE.MeshStandardMaterial).map as THREE.DataTexture).isDataTexture, 'and its copy is painted');
  p.dispose();
}

// --- 7: a MAIN mask follows the pattern picked --------------------------------------------------------------
{
  const lit = (a: number): Img => ({ width: 2, height: 2, rgba: Uint8Array.from([200, 100, 50, a, 200, 100, 50, a, 200, 100, 50, a, 200, 100, 50, a]) });
  const images: Record<string, Img> = { 'hull_a.png': lit(255), 'hull_b.png': lit(0) };
  const load = (f: string | null) => (f ? images[f] ?? null : null);
  const recipe: PaintRecipe = { ...recipeHull, shader: shader([{ tag: 'MAIN', variable: 'index_texture_1', private: false, default: 0, files: ['hull_a.png', 'hull_b.png'] }], []) };
  const a = runPaintJob(recipe, new Map([['index_texture_1', 0]]), {}, load)!;
  const b = runPaintJob(recipe, new Map([['index_texture_1', 1]]), {}, load)!;
  ok(!!a.emis && a.emis.rgba[0] === 200 && a.rgba[0] === 0 && a.rgba[3] === 255, 'the mask follows the pattern: pattern 1 (alpha 255) glows: the glow is the colour, the lit colour black');
  ok(!!b.emis && b.emis.rgba[0] === 0 && b.emis.rgba[3] === 255 && b.rgba[0] === 200, 'the mask follows the pattern: pattern 2 (alpha 0) of the same recipe does not: a black glow, the whole colour lit');
  ok(paintFiles(recipe, new Map([['index_texture_1', 1]])).join() === 'hull_b.png' && paintFiles(recipeHull, new Map()).sort().join() === 'hull_a.png,hull_n.png', 'the images a render reads: the choice at the value only, and the fixed textures');
  const plain = runPaintJob({ ...recipe, glow: undefined }, new Map([['index_texture_1', 0]]), {}, load)!;
  ok(!plain.emis && plain.rgba[0] === 200, 'a recipe without a glow renders whole, with no glow');
}

// --- the image cache --------------------------------------------------------------------------------------
{
  const c = new ImageCache(40);
  c.set('a', img2(1));
  c.set('b', img2(2));
  c.get('a');
  c.set('c', img2(3));
  ok(c.get('b') === undefined && c.get('a') !== undefined && c.get('c') !== undefined && c.size === 32, 'the image cache lets the least recently used go first, by bytes');
  c.set('gone', null);
  ok(c.get('gone') === null, 'a missing image is remembered as missing');
}

console.log(`shipPaint: ${checks} checks passed`);
