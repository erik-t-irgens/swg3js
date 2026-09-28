// What the dressed people share between their looks (src/world/mobiles/lookShare.ts): a part's own
// textures, the geometry of a body under the same clothes, and every colour render and normal map of
// the same values, each kept once however many looks wear it and disposed when the last one goes.
//
// Seven things are pinned. The keys: two sets of values share a render exactly when every value the
// recipe reads is the same, defaults and private scopes resolved as the render resolves them, on a
// recipe shaped like a real body's (a public and a private palette on the shader, a texture choice, a
// wrinkle map, a blueprint with a palette of its own), and checked against the renders themselves: an
// equal key is an equal picture. A part texture's key: the same image in two files is one texture, and
// drawn any other way it is not. The counting: a piece held by two looks is counted once, is referenced
// while either is out, and goes only with the last of them. What putting several looks down gives back:
// counted of the set, never added up look by look. The pictures: a render that comes out byte for byte
// the same as one already kept under another key is that one. The customizer: two people of one colouring
// draw one render between them and share one normal map, which is the same map drawn alone would be, two
// recipes of one folder never take each other's render, and a value that moves while a render is made
// does not end up in the render kept for the value before. And the finished look: its meshes and
// textures are swapped onto the pieces another look already has, a body the outfit culls differently
// keeps its own geometry, and whatever it took along the way and does not wear is let go.
//
// Everything is the game's own code under node: three's objects need no renderer to be made, shared
// and disposed, the customizer is fed its recipes and images through a stand-in for `fetch`, and the
// part files through a stand-in for the parser's own three fields.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { recipeNormalFiles, recipeValueKey, renderRecipe, type Img, type Recipe, type ShaderDef, type Stage, type Values } from '../../../src/player/texrender.ts';
import { Customizer, renderKeys } from '../../../src/player/customizer.ts';
import { FreeTally, LookShare, contentKey, hashBytes, indexKey, recordPartSources, shareLook, textureBytes, textureParams, geometryBytes, type LookSources, type PartFile, type PartSources } from '../../../src/world/mobiles/lookShare.ts';
import { encodePng } from '../png.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ------------------------------------------------------------------ a recipe to render
// One palette colour filling a 4 by 4 picture: the blueprint's one draw takes its colour from the
// texture factor, which the prepare step sets from a palette by the mesh's own (private) variable.
const PALETTE = 'palette/test.pal';
const COLOURS = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
];
function fillShader(palettes: ShaderDef['palettes'] = []): ShaderDef {
  return {
    effect: null,
    passes: [
      {
        alphaBlend: false,
        blendOp: 0,
        blendSrc: 0,
        blendDst: 0,
        alphaTest: false,
        alphaRefTag: null,
        alphaFunc: 0,
        writeMask: 15,
        tfactorTag: 'TFAC',
        stages: [{ colorOp: 2, colorArgs: [[0, 0, 0], [0, 0, 0], [5, 0, 0]], alphaOp: 2, alphaArgs: [[0, 0, 0], [0, 0, 0], [5, 0, 0]], result: 0, textureTag: 'NONE', coordSetTag: 'NONE' }],
      },
    ],
    textures: {},
    addresses: {},
    coordSets: {},
    tfactors: {},
    alphaRefs: {},
    choices: [],
    palettes,
  };
}
/** A 4 by 4 fan, or one of its halves, as a blueprint's vertices ([x, y, argb, u, v]). */
function fan(x0: number, x1: number): number[][] {
  return [[x0, 0, 0xffffffff, x0 / 4, 0], [x1, 0, 0xffffffff, x1 / 4, 0], [x1, 4, 0xffffffff, x1 / 4, 1], [x0, 4, 0xffffffff, x0 / 4, 1]];
}
function fillRecipe(mesh: string, material: string, palette: string): Recipe {
  return {
    mesh,
    material,
    kind: 'render',
    baseTag: 'MAIN',
    shader: null,
    slots: [
      {
        tag: 'MAIN',
        file: `${mesh}.trt`,
        blueprint: {
          width: 4,
          height: 4,
          camera: 4,
          shaders: [fillShader()],
          textures: [],
          vertexBuffers: [fan(0, 4)],
          uvSets: [1],
          indexBuffers: [],
          commands: [{ kind: 'draw', shader: 0, primitives: [{ kind: 'fan', vb: 0 }] }],
          prepare: [{ kind: 'palette', shader: 0, tag: 'TFAC', palette, variable: 0 }],
          variables: [{ name: '/private/index_color_1', private: true, kind: 'palette', default: 0, palette }],
        },
      },
    ],
  };
}
const RECIPE = fillRecipe('shirt_m_l0', 'shader/shirt.sht', PALETTE);
const COLOUR = 'shirt_m_l0|/private/index_color_1';
// A second recipe of the same folder, on another material, whose default value reads the very same
// string as the first one's: only the recipe itself tells their renders apart.
const PALETTE_B = 'palette/test_b.pal';
const COLOURS_B = [
  [10, 20, 30, 255],
  [40, 50, 60, 255],
];
const RECIPE_B = fillRecipe('pants_m_l0', 'shader/pants.sht', PALETTE_B);

// A body, shaped as the parts packs' body recipes are: baked over its own texture (picked by a choice)
// times the skin colour (a public palette on the shader) times a detail rendered by a blueprint (half
// from a palette on the blueprint's own shader, half from a blueprint variable), then times a hue (a
// private palette on the shader), with a wrinkle map chosen by the age for its normal map.
const PAL_SKIN = 'palette/skin.pal';
const PAL_HUE = 'palette/hue.pal';
const PAL_DETA = 'palette/deta.pal';
const PALETTES: Record<string, number[][]> = {
  [PALETTE]: COLOURS,
  [PALETTE_B]: COLOURS_B,
  [PAL_SKIN]: [[255, 230, 200, 255], [200, 150, 110, 255], [120, 80, 50, 255]],
  [PAL_HUE]: [[255, 255, 255, 255], [240, 200, 160, 255], [160, 220, 240, 255]],
  [PAL_DETA]: [[250, 250, 250, 255], [220, 180, 200, 255], [180, 240, 190, 255]],
};
const arg = (a: number): [number, number, number] => [a, 0, 0];
/** One stage: `colorOp` over current, `a1` and `a2` (0 current, 4 texture, 5 factor), the alpha taken from `a2`. */
const stage = (colorOp: number, a1: number, a2: number, textureTag = 'NONE'): Stage => ({ colorOp, colorArgs: [arg(0), arg(a1), arg(a2)], alphaOp: 2, alphaArgs: [arg(0), arg(0), arg(a2)], result: 0, textureTag, coordSetTag: 'NONE' });
const MESH = 'body_m_l0';
const SKIN = '/shared_owner/index_color_skin';
const HUE = `${MESH}|/private/index_color_1`;
const TEXTURE = `${MESH}|/private/index_texture_1`;
const AGE = `${MESH}|/private/index_age`;
const DETA_OWN = `${MESH}|/private/index_color_2`;
const DETA_VAR = `${MESH}|/private/index_color_3`;
const BODY: Recipe = {
  mesh: MESH,
  material: 'shader/body.sht',
  kind: 'bake',
  baseTag: 'MAIN',
  shader: {
    effect: null,
    passes: [
      { alphaBlend: false, blendOp: 0, blendSrc: 0, blendDst: 0, alphaTest: false, alphaRefTag: null, alphaFunc: 0, writeMask: 15, tfactorTag: 'TFAC', stages: [stage(3, 4, 5, 'MAIN'), stage(3, 0, 4, 'DETA')] },
      // Modulate what is there by the hue: nothing of the source, the destination times the source's colour.
      { alphaBlend: true, blendOp: 0, blendSrc: 0, blendDst: 2, alphaTest: false, alphaRefTag: null, alphaFunc: 0, writeMask: 15, tfactorTag: 'HUEB', stages: [stage(2, 0, 5)] },
    ],
    textures: {},
    addresses: {},
    coordSets: {},
    tfactors: {},
    alphaRefs: {},
    choices: [
      { tag: 'MAIN', variable: '/private/index_texture_1', private: true, default: 0, files: ['skin.png', 'skin_scar.png'] },
      { tag: 'CNRM', variable: '/private/index_age', private: true, default: 0, files: ['young_cn.png', 'old_cn.png'] },
    ],
    palettes: [
      { tag: 'TFAC', palette: PAL_SKIN, variable: SKIN, private: false, default: 0 },
      { tag: 'HUEB', palette: PAL_HUE, variable: '/private/index_color_1', private: true, default: 0 },
    ],
  },
  slots: [
    {
      tag: 'DETA',
      file: 'body_deta.trt',
      blueprint: {
        width: 4,
        height: 4,
        camera: 4,
        shaders: [fillShader([{ tag: 'TFAC', palette: PAL_DETA, variable: '/private/index_color_2', private: true, default: 0 }]), fillShader()],
        textures: [],
        vertexBuffers: [fan(0, 2), fan(2, 4)],
        uvSets: [1, 1],
        indexBuffers: [],
        commands: [
          { kind: 'draw', shader: 0, primitives: [{ kind: 'fan', vb: 0 }] },
          { kind: 'draw', shader: 1, primitives: [{ kind: 'fan', vb: 1 }] },
        ],
        prepare: [{ kind: 'palette', shader: 1, tag: 'TFAC', palette: PAL_DETA, variable: 0 }],
        variables: [{ name: '/private/index_color_3', private: true, kind: 'palette', default: 1, palette: PAL_DETA }],
      },
    },
  ],
};
/** A 4 by 4 picture of its own, different at every texel and from every other seed. */
function picture(seed: number, opaque = true): Img {
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i % 4 === 3 && opaque) ? 255 : 60 + ((i * 37 + seed * 101) % 190);
  return { width: 4, height: 4, rgba };
}
const IMAGES: Record<string, Img> = { 'skin.png': picture(1), 'skin_scar.png': picture(2), 'young_cn.png': picture(3), 'old_cn.png': picture(4) };
const lookupImage = (file: string | null): Img | null => (file ? IMAGES[file] ?? null : null);
const bake = (values: Values): string => Buffer.from(renderRecipe(BODY, values, PALETTES, lookupImage)!.rgba).toString('hex');

// ------------------------------------------------------------------ the keys
{
  const none = new Map<string, number>();
  const one = new Map([[COLOUR, 1]]);
  ok(recipeValueKey(RECIPE, none) === recipeValueKey(RECIPE, new Map([[COLOUR, 0]])), 'a value left unset and one set to its default are the same render');
  ok(recipeValueKey(RECIPE, one) !== recipeValueKey(RECIPE, none), 'a value the recipe reads, moved, is another render');
  ok(recipeValueKey(RECIPE, one) === recipeValueKey(RECIPE, new Map([[COLOUR, 1], ['index_color_skin', 7], ['pants_m_l0|/private/index_color_1', 3]])), 'values it does not read (the skin, another mesh\'s own colour) are the same render');
  ok(recipeValueKey(RECIPE, new Map([['shirt_m_l0|index_color_1', 1]])) === recipeValueKey(RECIPE, one), 'a private value under its short name is read as the render reads it');
  ok(recipeValueKey(RECIPE, new Map([['/private/index_color_1', 1]])) === recipeValueKey(RECIPE, none), 'but a private value set without its mesh is nobody\'s, as the render finds it');
  const withNormal: Recipe = {
    ...RECIPE,
    kind: 'bake',
    shader: { ...fillShader(), textures: { MAIN: 'main.png', NRML: 'plain_n.png' }, choices: [{ tag: 'CNRM', variable: '/private/index_age', private: true, default: 0, files: ['young_cn.png', 'old_cn.png'] }] },
  };
  const young = recipeNormalFiles(withNormal, none);
  const old = recipeNormalFiles(withNormal, new Map([['shirt_m_l0|/private/index_age', 1]]));
  ok(young[0] === 'young_cn.png' && young[1] === 'plain_n.png', 'the normal map is made from the files its choice picks, CNRM\'s and then NRML\'s');
  ok(old[0] === 'old_cn.png' && old[1] === young[1], 'and another pick is another normal map');
  ok(recipeNormalFiles(withNormal, new Map([['shirt_m_l0|/private/index_age', 9]])).join() === old.join(), 'a pick past the end is the last file, as the shader clamps it');
  ok(recipeNormalFiles(RECIPE, none).every((f) => f === null), 'a recipe whose shader names no normal map makes none');
  const a = renderKeys(withNormal, new Map([[COLOUR, 1]]), 'dir/');
  const b = renderKeys(withNormal, new Map([[COLOUR, 2]]), 'dir/');
  ok(a.render !== b.render && a.normal === b.normal && a.normal !== null, 'two colourings of one body share its normal map, which reads no colour');
  ok(renderKeys(withNormal, none, 'other/').normal !== a.normal, 'and a normal map is kept by the folder its files are in');
  ok(renderKeys(RECIPE, none, 'dir/').render !== renderKeys(RECIPE_B, none, 'dir/').render && recipeValueKey(RECIPE, none) === recipeValueKey(RECIPE_B, none), 'two recipes of one folder whose values read alike are two renders: the recipe is in the key');
}

// ------------------------------------------------------------------ the keys against the renders
{
  // Every value the body reads, moved on its own, is another key and another picture, whichever of the
  // shader's palettes, its choices, the blueprint's own shader or the blueprint's variables reads it.
  const base: Values = new Map([[SKIN, 1], [HUE, 1], [TEXTURE, 0], [AGE, 0], [DETA_OWN, 1], [DETA_VAR, 2]]);
  const moved = (key: string, v: number): Values => new Map([...base, [key, v]]);
  const baseKey = recipeValueKey(BODY, base);
  const basePicture = bake(base);
  const paints: [string, string, number][] = [
    ['the skin, a public palette on the shader', SKIN, 2],
    ['the hue, a private palette on the shader', HUE, 2],
    ['the texture, a choice on the shader', TEXTURE, 1],
    ['a palette on the blueprint\'s own shader', DETA_OWN, 2],
    ['a blueprint variable', DETA_VAR, 0],
  ];
  for (const [what, key, v] of paints) {
    ok(recipeValueKey(BODY, moved(key, v)) !== baseKey, `${what}, moved, is another key`);
    ok(bake(moved(key, v)) !== basePicture, `and another picture (${what})`);
  }
  ok(recipeValueKey(BODY, moved(AGE, 1)) !== baseKey && bake(moved(AGE, 1)) === basePicture, 'the wrinkle map\'s choice is read too, so it is in the key, though the colour never shows it');
  // An equal key is an equal picture, however the values are spelled: a public value by its short name,
  // a private one by its mesh and short name, a default left unset, and values nobody here reads.
  let state = 7;
  const next = (n: number): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return (state >>> 8) % n;
  };
  const DEFAULTS: Record<string, number> = { [SKIN]: 0, [HUE]: 0, [TEXTURE]: 0, [AGE]: 0, [DETA_OWN]: 0, [DETA_VAR]: 1 };
  const RANGES: Record<string, number> = { [SKIN]: 3, [HUE]: 3, [TEXTURE]: 2, [AGE]: 2, [DETA_OWN]: 3, [DETA_VAR]: 3 };
  const respell = (key: string): string => (key.includes('|') ? key.replace(/\|.*\//, '|') : key.replace(/^.*\//, ''));
  let pairs = 0;
  let collided = 0;
  const seen = new Map<string, string>();
  for (let n = 0; n < 120; n++) {
    const plain: Values = new Map();
    const other: Values = new Map();
    for (const key of Object.keys(RANGES)) {
      const v = next(RANGES[key]);
      plain.set(key, v);
      // The same value otherwise spelled, or left unset where it is the default.
      if (v === DEFAULTS[key] && next(2) === 0) continue;
      other.set(next(2) ? respell(key) : key, v);
    }
    other.set('pants_m_l0|/private/index_color_1', next(3));
    other.set('index_color_hair', next(3));
    const k1 = recipeValueKey(BODY, plain);
    const k2 = recipeValueKey(BODY, other);
    const p1 = bake(plain);
    if (k1 === k2 && p1 === bake(other)) pairs++;
    const before = seen.get(k1);
    if (before !== undefined) {
      collided++;
      assert.equal(before, p1, 'two value sets of one key bake one picture');
    } else seen.set(k1, p1);
  }
  ok(pairs === 120, `the same values however spelled are one key and one picture (${pairs} of 120)`);
  ok(collided > 0, `and every pair of draws that met on one key baked one picture (${collided} met)`);
}

// ------------------------------------------------------------------ a part texture's key
{
  // Two part files carrying the very same picture, a third drawing it otherwise, a fourth naming its
  // picture by address, and the parser's three fields as a stand-in for the loader's own.
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5, 6, 7, 8]).buffer;
  const other = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5, 6, 7, 9]).buffer;
  const file = (views: (ArrayBuffer | null)[], textures: THREE.Texture[], fail = false): PartFile => ({
    json: { textures: views.map((_, i) => ({ source: i })), images: views.map((v, i) => (v ? { bufferView: i } : {})) },
    associations: new Map(textures.map((t, i) => [t, { textures: i }])),
    getDependency: async (_type, index) => {
      if (fail) throw new Error('gone');
      return views[index];
    },
  });
  const meshWith = (maps: Partial<THREE.MeshStandardMaterial>, name = 'shader/body.sht'): THREE.Mesh => new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name, ...maps }));
  const into = (): PartSources => ({ meshes: new WeakMap(), textures: new WeakMap() });
  const human = new THREE.Texture();
  const zabrak = new THREE.Texture();
  const mirrored = new THREE.Texture();
  mirrored.wrapS = THREE.MirroredRepeatWrapping;
  const second = new THREE.Texture();
  second.channel = 1;
  const changed = new THREE.Texture();
  const addressed = new THREE.Texture();
  const loose = new THREE.Texture();
  const lost = new THREE.Texture();
  const a = into();
  const b = into();
  const humanMesh = meshWith({ map: human });
  const extra = meshWith({ map: loose }, 'shader/extra.sht');
  await recordPartSources(file([bytes], [human]), 'human/body.glb', [humanMesh, extra], a);
  await recordPartSources(file([bytes, bytes, bytes, other], [zabrak, mirrored, second, changed]), 'zabrak/body.glb', [meshWith({ map: zabrak, normalMap: mirrored, aoMap: second, roughnessMap: changed })], b);
  const key = (s: PartSources, t: THREE.Texture) => s.textures.get(t);
  ok(key(a, human) !== undefined && key(a, human) === key(b, zabrak), 'the same picture embedded in two part files is one key');
  ok(key(a, human)!.startsWith('png|') && key(a, human)!.includes(textureParams(human)), 'kept by its bytes and how it is drawn');
  ok(key(b, mirrored) !== key(b, zabrak), 'the same picture wrapped otherwise is another key');
  ok(key(b, second) !== key(b, zabrak), 'and read through another coordinate set, another again');
  ok(key(b, changed) !== key(b, zabrak), 'and one byte different, another picture');
  ok(key(a, loose) === `human/body.glb#shader/extra.sht:map|${textureParams(loose)}`, 'a texture the parser never listed is kept by its file, its material and its slot');
  const c = into();
  await recordPartSources(file([null], [addressed]), 'wardrobe/hat.glb', [meshWith({ map: addressed })], c);
  ok(key(c, addressed) === `wardrobe/hat.glb#0|${textureParams(addressed)}`, 'a picture named by address is kept by its file and its place in it');
  const d = into();
  await recordPartSources(file([bytes], [lost], true), 'wardrobe/lost.glb', [meshWith({ map: lost })], d);
  ok(key(d, lost) === `wardrobe/lost.glb#0|${textureParams(lost)}`, 'and so is one whose bytes the parser cannot give back');
  ok(a.meshes.get(humanMesh)?.index === 0 && a.meshes.get(extra)?.index === 1 && a.meshes.get(extra)?.file === 'human/body.glb', 'each mesh is kept as its file and its place among the file\'s meshes');
}

// ------------------------------------------------------------------ the counting
function tex(w: number, h: number): THREE.Texture {
  const t = new THREE.Texture();
  t.image = { width: w, height: h };
  return t;
}
function disposals(o: THREE.EventDispatcher<{ dispose: object }>): { n: number } {
  const c = { n: 0 };
  o.addEventListener('dispose', () => c.n++);
  return c;
}
{
  const store = new LookShare();
  const a = store.hold('characters/human_male/');
  const b = store.hold('characters/human_male/');
  ok(store.folderHeld('characters/human_male/') && !store.folderOut('characters/human_male/'), 'two looks of one body being built hold that body, and neither is out');
  const t = tex(64, 64);
  const gone = disposals(t);
  const size = textureBytes(t);
  ok(store.share(a, 't|body.glb#0', 'texture', t, size) === t, 'the first look to share a piece keeps its own');
  const t2 = tex(64, 64);
  ok(store.share(b, 't|body.glb#0', 'texture', t2, size) === t, 'the second is handed the first one\'s, not its copy');
  ok(store.bytes() === size, 'and it is counted once');
  ok(store.referencedBytes() === 0, 'while neither look is out, none of it is referenced');
  const ownerA = { refs: 0 };
  const ownerB = { refs: 0 };
  a.owner = ownerA;
  b.owner = ownerB;
  ok(!store.folderHeld('characters/human_male/'), 'two looks built and worn by nobody leave their body not out');
  ownerA.refs = 1;
  ok(store.referencedBytes() === size && store.folderHeld('characters/human_male/'), 'one of them worn: referenced, once');
  ok(store.folderOut('characters/human_male/', b) && !store.folderOut('characters/human_male/', a), 'and another look of that body is out beside the second, and none beside the first');
  ownerB.refs = 2;
  ok(store.referencedBytes() === size, 'both worn: still once');
  ok(store.soleBytes(a) === 0 && store.onlyBytes(a) === 0, 'taking the first look\'s last body down gives back nothing the second still wears');
  ownerB.refs = 0;
  ok(store.soleBytes(a) === size, 'with the second worn by nobody, the first one\'s body gives it all back');
  ok(a.release() === 0 && gone.n === 0 && store.owns(t), 'the first look disposed: the piece stays for the second');
  ok(b.release() === size && gone.n === 1 && !store.owns(t) && store.bytes() === 0, 'the last look disposed: the piece is disposed once, and nothing is counted');
  ok(b.release() === 0 && gone.n === 1, 'a hold let go twice gives back nothing the second time');
  ok(!store.folderHeld('characters/human_male/'), 'and the body is no longer out');
}

// ------------------------------------------------------------------ what putting several down gives back
{
  // Three looks out: A and B alone share a body (100), all three a shirt (50), and a kept look nobody
  // wears shares a hat with A (30). A's own bytes are 10, B's 20 and C's 5.
  const store = new LookShare();
  const [hA, hB, hC, hD] = ['f/', 'f/', 'f/', 'f/'].map((f) => store.hold(f));
  const A = { bytes: 10, refs: 1, hold: hA };
  const B = { bytes: 20, refs: 1, hold: hB };
  const C = { bytes: 5, refs: 1, hold: hC };
  const D = { bytes: 0, refs: 0, hold: hD };
  hA.owner = A;
  hB.owner = B;
  hC.owner = C;
  hD.owner = D;
  const piece = (bytes: number, ...holds: typeof hA[]) => {
    const t = tex(1, 1);
    for (const h of holds) store.share(h, `t|${bytes}`, 'texture', t, bytes);
  };
  piece(100, hA, hB);
  piece(50, hA, hB, hC);
  piece(30, hA, hD);
  const tally = new FreeTally();
  tally.reset();
  ok(tally.add(A, null) === 10 + 30, 'A alone gives back its own bytes and the hat only a kept look shares with it');
  ok(tally.add(B, null) === 10 + 30 + 20 + 100, 'A and B together give back the body they alone share as well');
  const alone = store.soleBytes(hA) + A.bytes + store.soleBytes(hB) + B.bytes;
  ok(alone === 60 && alone < tally.total, `which neither's own figure has: added up look by look it is ${alone}, together ${tally.total}`);
  ok(tally.add(C, null) === 10 + 30 + 20 + 100 + 5 + 50, 'and all three, the shirt too');
  tally.reset();
  ok(tally.add(A, null) === 40 && tally.add(C, null) === 45, 'a set starts again at nought: A and C give back nothing B still wears');
  // One look worn by two bodies, and one pack two of them play: each goes with the second body.
  const worn = { bytes: 40, refs: 2 };
  const pack = { bytes: 7, refs: 2 };
  tally.reset();
  ok(tally.add(worn, pack) === 0 && tally.add(worn, pack) === 47 && tally.add(worn, pack) === 47, 'a look and a pack two bodies hold go with the second of them, and are counted once however many more are asked about');
  tally.reset();
  ok(tally.add(D, null) === 0 && tally.add(null, null) === 0, 'a look nobody wears, and a body still loading, give back nothing');
  // Nothing moves while a set is counted: the pieces' holds and bytes are as they were.
  ok(store.referencedBytes() === 100 + 50 + 30 && store.bytes() === 180, 'counting a set changes nothing in the share');
}

// ------------------------------------------------------------------ a render made once for everyone waiting
{
  const store = new LookShare();
  const a = store.hold('f/');
  const b = store.hold('f/');
  let makes = 0;
  let release!: () => void;
  const ready = new Promise<void>((r) => (release = r));
  const made = tex(8, 8);
  const make = async () => {
    makes++;
    await ready;
    return made;
  };
  const pa = a.claim('1|0', 'render', make);
  const pb = b.claim('1|0', 'render', make);
  release();
  const [ta, tb] = await Promise.all([pa, pb]);
  ok(makes === 1 && ta === made && tb === made, 'two looks asking for one render at once make it once and both wear it');
  ok(store.stats().kinds.render.n === 1 && store.stats().kinds.render.worn === 2, 'kept once, worn twice');
  const c = store.hold('f/');
  const tc = await c.claim('1|0', 'render', async () => {
    makes++;
    return tex(8, 8);
  });
  ok(tc === made && makes === 1, 'a later look of the same colours takes it without making it');
  // Every look waiting for a render lets go before it lands: nothing is kept for nobody.
  const d = store.hold('f/');
  let land!: () => void;
  const landed = new Promise<void>((r) => (land = r));
  const orphan = tex(8, 8);
  const pd = d.claim('2|0', 'render', async () => {
    await landed;
    return orphan;
  });
  d.release();
  land();
  ok((await pd) === null && !store.owns(orphan) && store.stats().kinds.render.n === 1, 'a render whose only look let go while it was made is dropped, not kept for nobody');
  const e = store.hold('f/');
  e.release();
  ok((await e.claim('1|0', 'render', make)) === null && store.stats().kinds.render.worn === 3, 'and a look already let go takes nothing');
}

// ------------------------------------------------------------------ one picture kept once, however it was reached
{
  const store = new LookShare();
  const a = store.hold('characters/human_male/');
  const b = store.hold('characters/zabrak_male/');
  const pixels = () => {
    const d = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < d.length; i++) d[i] = (i * 37) & 255;
    return d;
  };
  const picture = (data: Uint8Array, anisotropy = 4) => {
    const t = new THREE.DataTexture(data, 4, 4, THREE.RGBAFormat);
    t.anisotropy = anisotropy;
    return t;
  };
  const first = picture(pixels());
  const copy = picture(pixels());
  const copyGone = disposals(copy);
  ok(contentKey(first) === contentKey(copy) && contentKey(first) !== null, 'two renders of the same pixels and the same drawing have one content key');
  const other = pixels();
  other[37] ^= 1;
  ok(contentKey(picture(other)) !== contentKey(first), 'one byte different anywhere is another picture');
  ok(contentKey(picture(pixels(), 1)) !== contentKey(first), 'and the same pixels drawn otherwise (a part\'s normal map against a render of it) are another texture');
  ok(contentKey(tex(4, 4)) === null, 'a texture whose pixels are not to hand has no content key');
  // The human folder's normal map and the Zabrak folder's copy of it: two keys, one picture.
  const ta = await a.claim('characters/human_male/customize/|hum_m_body_cn.png|', 'normal', async () => first);
  const tb = await b.claim('characters/zabrak_male/customize/|hum_m_body_cn.png|', 'normal', async () => copy);
  ok(ta === first && tb === first, 'a render that comes out the same as one kept under another key is that one');
  ok(copyGone.n === 1 && !store.owns(copy), 'and the new copy, never drawn, is dropped');
  ok(store.stats().entries === 1 && store.bytes() === textureBytes(first), 'one picture, counted once');
  let makes = 0;
  const c = store.hold('characters/zabrak_male/');
  const again = await c.claim('characters/zabrak_male/customize/|hum_m_body_cn.png|', 'normal', async () => (makes++, picture(pixels())));
  ok(again === first && makes === 0, 'and the second key finds it from then on without making it');
  const firstGone = disposals(first);
  a.release();
  b.release();
  ok(firstGone.n === 0 && store.owns(first), 'the looks that brought it gone, it stays for the one still wearing it');
  c.release();
  ok(firstGone.n === 1 && store.stats().entries === 0 && store.keyOf(first) === null, 'the last gone, every key it was kept under goes with it');
  ok(hashBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])) !== hashBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 9])) && hashBytes(new Uint8Array([1, 2, 3])) === hashBytes(new Uint8Array([1, 2, 3])), 'the bytes hash reads every byte, aligned or not');
  ok(textureParams(picture(pixels())) === textureParams(picture(pixels())), 'the drawing of two textures made alike is the same');
}

// ------------------------------------------------------------------ the customizer through the share
const DIR = 'http://pack/wardrobe/human_male/';
const BODY_DIR = 'http://pack/characters/human_male/';
const FILE = { images: 'customize/', recipes: [RECIPE, RECIPE_B], palettes: { [PALETTE]: COLOURS, [PALETTE_B]: COLOURS_B } };
const BODY_FILE = { images: 'customize/', recipes: [BODY], palettes: PALETTES };
const PNGS = new Map(Object.entries(IMAGES).map(([name, img]) => [`${BODY_DIR}customize/${name}`, encodePng(4, 4, img.rgba as Uint8Array)]));
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  if (url === `${DIR}customize.json`) return json(FILE);
  if (url === `${BODY_DIR}customize.json`) return json(BODY_FILE);
  const png = PNGS.get(url);
  if (png) return new Response(png);
  return new Response('', { status: 404 });
};
/** A customizer over the named materials, through `share`'s hold when there is one, counting the renders the hold has made. */
async function customizer(share: LookShare | null, dir: string, names: string[]): Promise<{ mats: Map<string, THREE.MeshStandardMaterial>; cz: Customizer; hold: ReturnType<LookShare['hold']> | null; makes: () => number }> {
  const mats = new Map(names.map((n) => [n, new THREE.MeshStandardMaterial({ name: n })]));
  const cz = new Customizer();
  const hold = share ? share.hold(dir) : null;
  let makes = 0;
  if (hold) {
    const claim = hold.claim.bind(hold);
    hold.claim = (key, kind, make) => claim(key, kind, () => (makes++, make()));
    cz.share = hold;
  }
  cz.materialsFor = (name) => {
    const m = mats.get(name);
    return m ? [m] : [];
  };
  ok(await cz.addSource(dir), 'the recipes load');
  return { mats, cz, hold, makes: () => makes };
}
async function colourOne(share: LookShare | null, value: number): Promise<{ mat: THREE.MeshStandardMaterial; cz: Customizer; hold: ReturnType<LookShare['hold']> | null; makes: () => number }> {
  const c = await customizer(share, DIR, [RECIPE.material]);
  c.cz.setAll({ [COLOUR]: value });
  await c.cz.settled();
  return { mat: c.mats.get(RECIPE.material)!, cz: c.cz, hold: c.hold, makes: c.makes };
}
function pixel(t: THREE.Texture | null): number[] {
  const d = (t?.image as { data?: Uint8Array } | undefined)?.data;
  return d ? [d[0], d[1], d[2], d[3]] : [];
}
function pixels(t: THREE.Texture | null): string {
  const d = (t?.image as { data?: Uint8Array } | undefined)?.data;
  return d ? Buffer.from(d).toString('hex') : '';
}
{
  const store = new LookShare();
  const first = await colourOne(store, 1);
  ok(first.mat.map instanceof THREE.DataTexture && pixel(first.mat.map).join() === COLOURS[1].join(), 'a shared look is coloured as ever: the palette\'s second colour');
  ok(first.makes() === 1, 'and made the render itself, being the first');
  const second = await colourOne(store, 1);
  ok(second.makes() === 0 && second.mat.map === first.mat.map, 'a second look of the same colours draws nothing and wears the first one\'s render');
  const third = await colourOne(store, 2);
  ok(third.makes() === 1 && third.mat.map !== first.mat.map && pixel(third.mat.map).join() === COLOURS[2].join(), 'a third of another colour draws its own');
  ok(store.stats().kinds.render.n === 2 && store.stats().kinds.normal.n === 0, 'two renders kept for three looks, and no normal map where the shader names none');
  const count = disposals(first.mat.map!);
  third.cz.dispose();
  second.cz.dispose();
  ok(count.n === 0 && store.owns(first.mat.map), 'a shared customizer disposed disposes nothing it was handed');
  first.hold!.release();
  ok(count.n === 0, 'the render stays while a look still holds it');
  second.hold!.release();
  ok(count.n === 1, 'and goes with the last');
  // Unshared, exactly as before: each character its own texture.
  const alone1 = await colourOne(null, 1);
  const alone2 = await colourOne(null, 1);
  ok(alone1.mat.map !== alone2.mat.map && pixel(alone1.mat.map).join() === COLOURS[1].join(), 'without a share every character still draws its own');
}
{
  // Two recipes of one folder whose values read the same string: each material its own render, in its
  // own colours, shared or not.
  const store = new LookShare();
  const both = await customizer(store, DIR, [RECIPE.material, RECIPE_B.material]);
  both.cz.renderAll();
  await both.cz.settled();
  const shirt = both.mats.get(RECIPE.material)!.map;
  const pants = both.mats.get(RECIPE_B.material)!.map;
  ok(shirt !== pants && pixel(shirt).join() === COLOURS[0].join() && pixel(pants).join() === COLOURS_B[0].join(), 'two recipes of one folder whose values read alike each wear their own render, in their own colours');
  ok(both.makes() === 2 && store.stats().kinds.render.n === 2, 'two renders made and kept, one for each');
}
{
  // The body: a bake with a wrinkle map for its normal map, shared against drawn alone.
  const store = new LookShare();
  const colour = async (share: LookShare | null, skin: number, age: number) => {
    const c = await customizer(share, BODY_DIR, [BODY.material]);
    c.cz.setAll({ [SKIN]: skin, [AGE]: age });
    await c.cz.settled();
    return { mat: c.mats.get(BODY.material)!, makes: c.makes, cz: c.cz };
  };
  const shared = await colour(store, 1, 0);
  const alone = await colour(null, 1, 0);
  const sm = shared.mat;
  const am = alone.mat;
  ok(sm.map !== null && sm.normalMap !== null && sm.map !== sm.normalMap, 'a shared body wears a colour render and, beside it, a normal map of its own');
  ok(pixels(sm.map) === pixels(am.map) && pixels(sm.map) === bake(new Map([[SKIN, 1], [AGE, 0]])), 'its colour is exactly what drawing it alone makes');
  ok(pixels(sm.normalMap) === pixels(am.normalMap) && pixels(sm.normalMap) !== '', 'and so is its normal map');
  ok(sm.map!.colorSpace === THREE.SRGBColorSpace && sm.normalMap!.colorSpace === THREE.NoColorSpace && sm.normalMap!.colorSpace === am.normalMap!.colorSpace, 'the colour in sRGB and the normal map as it stands, as drawn alone');
  ok(textureParams(sm.map!) === textureParams(am.map!) && textureParams(sm.normalMap!) === textureParams(am.normalMap!), 'each drawn exactly as the one drawn alone is');
  ok(shared.makes() === 2 && store.stats().kinds.render.n === 1 && store.stats().kinds.normal.n === 1, 'one colour render and one normal map made and kept');
  const darker = await colour(store, 2, 0);
  ok(darker.mat.normalMap === sm.normalMap && darker.mat.map !== sm.map && darker.makes() === 1, 'another skin of the same age takes the first one\'s normal map and makes only its own colour');
  const older = await colour(store, 1, 1);
  ok(older.mat.normalMap !== sm.normalMap && pixels(older.mat.normalMap) === pixels((await colour(null, 1, 1)).mat.normalMap), 'another age makes the other wrinkle map\'s, as drawn alone');
  ok(pixels(older.mat.map) === pixels(sm.map), 'while its colour, which the age never shows, comes out the same picture');
  ok(older.mat.map === sm.map && older.makes() === 2, 'and is kept as the one picture it is, though it was drawn again under its own key');
}
{
  // A value moved while a shared render is being made: the render kept for the value before is that
  // value's picture, and the look ends on the new one's.
  const store = new LookShare();
  const c = await customizer(store, BODY_DIR, [BODY.material]);
  c.cz.setAll({ [SKIN]: 1 });
  // Nothing of the render has been drawn yet: it waits for its images.
  c.cz.set(SKIN, 2);
  await c.cz.settled();
  ok(pixels(c.mats.get(BODY.material)!.map) === bake(new Map([[SKIN, 2]])), 'a look whose value moved mid-render ends on the new value');
  const later = await customizer(store, BODY_DIR, [BODY.material]);
  later.cz.setAll({ [SKIN]: 1 });
  await later.cz.settled();
  ok(later.makes() === 0 && pixels(later.mats.get(BODY.material)!.map) === bake(new Map([[SKIN, 1]])), 'and the render kept for the value before is that value\'s picture, not the new one\'s');
}

// ------------------------------------------------------------------ a finished look put on the shared pieces
function bodyGeometry(culled: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setIndex(culled ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]);
  return g;
}
interface Built {
  root: THREE.Group;
  body: THREE.Mesh;
  shirt: THREE.Mesh;
  sources: LookSources;
}
/** A look as the character leaves it: a body and a shirt, each from its own file with its own textures, the shirt coloured by a render the customizer claimed. */
function look(culled: boolean, render: THREE.Texture, textures = { body: tex(32, 32), normal: tex(32, 32), shirt: tex(16, 16) }): Built {
  const root = new THREE.Group();
  const body = new THREE.Mesh(bodyGeometry(culled), new THREE.MeshStandardMaterial({ name: 'shader/body.sht', map: textures.body, normalMap: textures.normal }));
  const shirt = new THREE.Mesh(bodyGeometry(false), new THREE.MeshStandardMaterial({ name: 'shader/shirt.sht', map: render }));
  root.add(body, shirt);
  const meshes = new Map<THREE.Mesh, { file: string; index: number }>([
    [body, { file: 'body.glb', index: 0 }],
    [shirt, { file: 'shirt.glb', index: 0 }],
  ]);
  const texSrc = new Map<THREE.Texture, string>([
    [textures.body, 'body.glb#0|0|srgb'],
    [textures.normal, 'body.glb#1|0|'],
    [textures.shirt, 'shirt.glb#0|0|srgb'],
  ]);
  return { root, body, shirt, sources: { root, skeleton: 'characters/human_male/', meshSource: (m) => meshes.get(m) ?? null, textureSource: (t) => texSrc.get(t) ?? null } };
}
{
  const store = new LookShare();
  const holdA = store.hold('characters/human_male/');
  const renderA = (await holdA.claim('9|1', 'render', async () => tex(16, 16)))!;
  // Something claimed along the way and not worn in the end: a render the shirt was coloured with
  // before a later value took its place.
  const stale = (await holdA.claim('9|0', 'render', async () => tex(16, 16)))!;
  const staleGone = disposals(stale);
  const A = look(false, renderA);
  shareLook(holdA, A.sources);
  ok(staleGone.n === 1 && !store.owns(stale), 'a render the finished look does not wear is let go (and, held by nobody else, disposed)');
  ok(store.owns(A.body.geometry) && store.owns((A.body.material as THREE.MeshStandardMaterial).map) && store.owns((A.body.material as THREE.MeshStandardMaterial).normalMap), 'the first look\'s body geometry and part textures are kept as the shared ones');
  const bodyGeoA = A.body.geometry;
  const holdB = store.hold('characters/human_male/');
  const renderB = (await holdB.claim('9|1', 'render', async () => tex(16, 16)))!;
  ok(renderB === renderA, 'the second look\'s shirt render is the first one\'s (same colours)');
  const B = look(false, renderB);
  const ownGeo = B.body.geometry;
  const ownMap = (B.body.material as THREE.MeshStandardMaterial).map;
  shareLook(holdB, B.sources);
  ok(B.body.geometry === bodyGeoA && B.body.geometry !== ownGeo, 'a second look of the same body under the same outfit wears the first one\'s geometry');
  ok((B.body.material as THREE.MeshStandardMaterial).map === (A.body.material as THREE.MeshStandardMaterial).map && (B.body.material as THREE.MeshStandardMaterial).map !== ownMap, 'and its textures');
  ok(B.body.material !== A.body.material, 'while its materials stay its own, where its own colours go');
  ok(B.shirt.geometry === A.shirt.geometry, 'the shirt, from one file, one geometry');
  const C = look(true, renderA);
  const holdC = store.hold('characters/human_male/');
  shareLook(holdC, C.sources);
  ok(C.body.geometry !== bodyGeoA && store.owns(C.body.geometry) && indexKey(C.body.geometry) !== indexKey(bodyGeoA), 'a body the outfit culls otherwise keeps a geometry of its own, shared under its own triangles');
  const hat = tex(8, 8);
  const D = look(false, renderA);
  (D.shirt.material as THREE.MeshStandardMaterial).alphaMap = hat;
  const holdD = store.hold('characters/twilek_female/');
  shareLook(holdD, { ...D.sources, skeleton: 'characters/twilek_female/' });
  ok(D.body.geometry !== bodyGeoA, 'the same file on another skeleton is another geometry (its joints are fitted to that skeleton)');
  ok(!store.owns(hat) && (D.shirt.material as THREE.MeshStandardMaterial).alphaMap === hat, 'a texture no part file carried stays the look\'s own');
  const kinds = store.stats().kinds;
  const geoBytes = geometryBytes(bodyGeoA);
  // The human body whole and culled, the Twi'lek's body, and the shirt on each skeleton.
  ok(kinds.geometry.n === 5 && kinds.geometry.worn === 8, `five geometries kept for eight meshes (${kinds.geometry.n}, worn ${kinds.geometry.worn})`);
  ok(kinds.texture.n === 2 && kinds.texture.worn === 8 && kinds.render.n === 1, 'two part textures and one render, worn by all four: a texture fits any skeleton');
  const geoGone = disposals(bodyGeoA);
  holdA.release();
  ok(geoGone.n === 0 && store.owns(bodyGeoA), 'the first look disposed, the geometry the second wears stays');
  holdB.release();
  ok(geoGone.n === 1 && !store.owns(bodyGeoA), 'the second disposed, it goes');
  holdC.release();
  holdD.release();
  ok(store.bytes() === 0 && store.stats().entries === 0 && geoBytes > 0, 'every look gone, nothing is left or counted');
}

console.log(`\n${passed} checks passed`);
