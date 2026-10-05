// A look's colours on their way onto a character and off it onto the wire (src/player/look.ts).
//
// Two defects the Creator and dye pass found by reading the code, each confirmed here before it was
// mended. A fresh rig is coloured before it is dressed, and the colours were filtered on whether any
// recipe read them yet -- which a garment's and a hairstyle's do only once the wardrobe has joined -- so
// every peer was seen the first time in default garment and hair colours, and the select screen's first
// stand of a character too. And a saved look only ever grows (every shirt ever coloured stays in it),
// while the wire keeps the first 120 numbers, so in time the colours on show would fall off the end.
//
// The customizer is the game's own, fed one recipe through a stand-in for `fetch`; the character is a
// stand-in with the few methods `applyAppearance`, `applyLook` and `applyLookPrepared` call.
//
// Run: node tools/swg/tests/lookValues.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Customizer } from '../../../src/player/customizer.ts';
import { applyAppearance, applyLook, applyLookPrepared, lookKeep, packLook, putBackLook } from '../../../src/player/look.ts';
import type { Recipe, ShaderDef } from '../../../src/player/texrender.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ---------------------------------------------------------------- a shirt whose colour is its own palette's
const PALETTE = 'palette/test.pal';
const COLOURS = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
];
function fillShader(): ShaderDef {
  return {
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
}
const SHIRT: Recipe = {
  mesh: 'shirt_m_l0',
  material: 'shader/shirt.sht',
  kind: 'render',
  baseTag: 'MAIN',
  shader: null,
  slots: [
    {
      tag: 'MAIN',
      file: 'shirt.trt',
      blueprint: {
        width: 4,
        height: 4,
        camera: 4,
        shaders: [fillShader()],
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
const SHIRT_KEY = 'shirt_m_l0|/private/index_color_1';
// A head whose skin is the owner's shared colour with a private copy of its own, which is what the
// head's texture reads (the human head's `index_color_skin` is both, and the copy follows the shared one).
const SKIN = 'index_color_skin';
const HEAD_SKIN = 'head_m_l0|index_color_skin';
const HEAD: Recipe = {
  ...SHIRT,
  mesh: 'head_m_l0',
  material: 'shader/head.sht',
  slots: [
    {
      ...SHIRT.slots[0],
      file: 'head.trt',
      blueprint: {
        ...SHIRT.slots[0].blueprint,
        prepare: [{ kind: 'palette', shader: 0, tag: 'TFAC', palette: PALETTE, variable: 1 }],
        variables: [
          { name: SKIN, private: false, kind: 'palette', default: 0, palette: PALETTE },
          { name: SKIN, private: true, kind: 'palette', default: 0, palette: PALETTE },
        ],
      },
    },
  ],
};
const WARDROBE = 'http://pack/wardrobe/human_male/';
const SPECIES = 'http://pack/characters/human_male/';
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  if (url === `${WARDROBE}customize.json`) return new Response(JSON.stringify({ images: 'customize/', recipes: [SHIRT], palettes: { [PALETTE]: COLOURS } }), { headers: { 'content-type': 'application/json' } });
  if (url === `${SPECIES}customize.json`) return new Response(JSON.stringify({ images: 'customize/', recipes: [HEAD], palettes: { [PALETTE]: COLOURS } }), { headers: { 'content-type': 'application/json' } });
  return new Response('', { status: 404 });
};
const pixel = (t: THREE.Texture | null): string => {
  const d = (t?.image as { data?: Uint8Array } | undefined)?.data;
  return d ? [d[0], d[1], d[2], d[3]].join() : '';
};

/** A stand-in character: a real customizer, no wardrobe until `catalogue`, and its shirt's material only once it is "loaded". */
function standIn(order: string[] = []) {
  const cz = new Customizer();
  const shirt = new THREE.MeshStandardMaterial({ name: SHIRT.material });
  let loaded = false;
  cz.materialsFor = (name) => (loaded && name === SHIRT.material ? [shirt] : []);
  const c = {
    manifest: { values: {} as Record<string, number> },
    customizer: cz,
    morphs: {} as Record<string, number>,
    setMorph(name: string, v: number) {
      order.push('appearance');
      this.morphs[name] = v;
      return true;
    },
    setHeight() {},
    canCustomize: (k: string) => cz.affects(k),
    async catalogue() {
      order.push('catalogue');
      await cz.addSource(WARDROBE);
      return { species: '', gender: '', items: [] };
    },
    status: () => [] as { name: string; worn: boolean; body: boolean }[],
    async wear() {
      return true;
    },
    async wearItem() {
      return true;
    },
    async loadPiece() {
      order.push('load');
      // The piece arrives: its materials are there, and the character reapplies as `addPart` does.
      loaded = true;
      cz.reapply();
      return { found: true, meshes: [] as THREE.Object3D[] };
    },
    putOn() {
      order.push('putOn');
    },
    wearShirt() {
      loaded = true;
      cz.reapply();
    },
  };
  return { c, cz, shirt };
}

// ---------------------------------------------------------------- a garment's colour on a fresh rig
{
  // What it did before: the filter asked whether a recipe read the key, and none did yet.
  const { c, cz } = standIn();
  ok(!cz.affects(SHIRT_KEY), 'on a fresh rig no recipe reads a garment colour yet (the wardrobe has not joined)');
  applyAppearance(c as never, { morphs: {}, values: { [SHIRT_KEY]: 2, 'hair|index_color_1': 5 }, height: 0.5 });
  ok(cz.values.get(SHIRT_KEY) === 2, 'a colour scoped to a mesh survives applyAppearance all the same');
  ok(cz.values.get('hair|index_color_1') === 5, 'and so does the remembered hair colour, which no recipe will ever read');
}
{
  const { c, cz, shirt } = standIn();
  applyAppearance(c as never, { morphs: {}, values: { [SHIRT_KEY]: 2 }, height: 0.5 });
  await cz.addSource(WARDROBE);
  c.wearShirt();
  await cz.settled();
  ok(shirt.map instanceof THREE.DataTexture && pixel(shirt.map) === COLOURS[2].join(), 'and when the shirt arrives, reapply renders it in that colour');
}
{
  const order: string[] = [];
  const { c, cz, shirt } = standIn(order);
  await applyLook(c as never, { morphs: { blend_fat: 0.5 }, values: { [SHIRT_KEY]: 1 }, height: 0.5, outfit: ['shirt'] }, '');
  ok(order[0] === 'catalogue' && order.indexOf('appearance') > 0, 'applyLook brings the wardrobe in before it sets the colours');
  ok(cz.values.get(SHIRT_KEY) === 1 && cz.affects(SHIRT_KEY), 'so the colour is set where a recipe reads it');
  c.wearShirt();
  await cz.settled();
  ok(pixel(shirt.map) === COLOURS[1].join(), 'and the shirt wears it the moment it is on');
}
{
  const order: string[] = [];
  const { c, cz, shirt } = standIn(order);
  await applyLookPrepared(c as never, { morphs: { blend_fat: 0.5 }, values: { [SHIRT_KEY]: 2 }, height: 0.5, outfit: ['shirt'] }, '', async () => {}, () => true);
  ok(order.join() === 'catalogue,appearance,load,putOn', `applyLookPrepared too, then loads hidden and puts on (${order.join(', ')})`);
  await cz.settled();
  ok(pixel(shirt.map) === COLOURS[2].join(), "a peer's shirt is in their colour on first sight");
  const stopped: string[] = [];
  let alive = true;
  const late = standIn(stopped);
  const pending = applyLookPrepared(late.c as never, { morphs: { blend_fat: 1 }, values: {}, height: 0.5, outfit: [] }, '', async () => {}, () => alive);
  alive = false;
  await pending;
  ok(!stopped.includes('appearance'), 'and a look whose peer has gone while the wardrobe loaded is not put on');
}
{
  // A character with no wardrobe at all still takes its shape and colours.
  const { c, cz } = standIn();
  c.catalogue = async () => {
    throw new Error('no wardrobe');
  };
  await applyLook(c as never, { morphs: { blend_fat: 0.25 }, values: { [SHIRT_KEY]: 1 }, height: 0.5, outfit: [] }, '');
  ok(c.morphs.blend_fat === 0.25 && cz.values.get(SHIRT_KEY) === 1, 'a character with no wardrobe still takes its look');
}

// ---------------------------------------------------------------- only what is on show goes on the wire
{
  const a = { morphs: { blend_fat: 0.123456 }, values: { index_color_skin: 3, [SHIRT_KEY]: 2, 'hat_m_l0|/private/index_color_1': 7, 'hair|index_color_1': 4, 'hum_m_head_l0|index_color_2': 9 }, height: 0.5 };
  const keep = lookKeep(new Set(['shirt_m_l0', 'hum_m_head_l0']));
  const sent = packLook(a, ['shirt'], keep);
  ok(Object.keys(sent.values).sort().join() === ['hum_m_head_l0|index_color_2', 'index_color_skin', SHIRT_KEY].sort().join(), 'a shared colour and a worn mesh\'s own go out; a hat not worn and the remembered hair colour stay home');
  ok(Object.keys(packLook(a, ['shirt']).values).length === 5, 'with nothing to keep by, everything goes, as before');
  ok(sent.morphs.blend_fat === 0.123, 'the shape is rounded as it always was');
  const many: Record<string, number> = { index_color_skin: 1 };
  for (let i = 0; i < 200; i++) many[`old_${i}_m_l0|/private/index_color_1`] = i % 255;
  many[SHIRT_KEY] = 2;
  const trimmed = packLook({ morphs: {}, values: many, height: 0.5 }, [], keep);
  ok(Object.keys(trimmed.values).length === 2 && trimmed.values[SHIRT_KEY] === 2, 'two hundred colours of things long taken off do not push the shirt on show past the wire\'s 120');
}

// ---------------------------------------------------------------- a rig another character has just worn

/** A stand-in wearing a head that is always on and the shirt, with the species' and the wardrobe's recipes in. */
async function wornRig() {
  const s = standIn();
  const head = new THREE.MeshStandardMaterial({ name: HEAD.material });
  const worn = s.cz.materialsFor;
  s.cz.materialsFor = (name) => (name === HEAD.material ? [head] : worn(name));
  await s.cz.addSource(SPECIES);
  await s.cz.addSource(WARDROBE);
  s.c.wearShirt();
  await s.cz.settled();
  return { ...s, head };
}
const look = (values: Record<string, number>) => ({ morphs: {}, values, height: 0.5 });
{
  // The first character: a skin, a shirt colour, a remembered hair colour and a hat it never put on here.
  const { c, cz, shirt, head } = await wornRig();
  applyAppearance(c as never, look({ [SKIN]: 2, [SHIRT_KEY]: 1, 'hair|index_color_1': 4, 'hat_m_l0|/private/index_color_1': 3 }));
  await cz.settled();
  ok(cz.values.get(HEAD_SKIN) === 2 && pixel(head.map) === COLOURS[2].join() && pixel(shirt.map) === COLOURS[1].join(), "the first character's skin reaches the head's own copy, and the shirt wears its colour");
  // The second names none of it (a character made without touching the skin).
  putBackLook(c as never, look({}));
  ok((cz.values.get(SKIN) ?? 0) === (cz.values.get(HEAD_SKIN) ?? 0), "put back for a record that names no skin, the shared skin and the head's copy go back together, so the head and the body cannot come out two colours");
  ok(!cz.values.has('hair|index_color_1') && !cz.values.has('hat_m_l0|/private/index_color_1'), 'what nothing on the rig reads is forgotten at once');
  await cz.settled();
  await Promise.resolve();
  ok(pixel(head.map) === COLOURS[0].join() && pixel(shirt.map) === COLOURS[0].join(), "the head and the shirt render in the pack's own colours");
  ok(cz.values.size === 0, `and once they have, nothing of the first character is left to be saved into the second one's record (${[...cz.values.keys()].join(', ') || 'nothing'})`);
}
{
  // The second asks for the very skin the first had: nothing moves, and the head's copy stays with it.
  const { c, cz, head } = await wornRig();
  applyAppearance(c as never, look({ [SKIN]: 2 }));
  await cz.settled();
  putBackLook(c as never, look({ [SKIN]: 2 }));
  applyAppearance(c as never, look({ [SKIN]: 2 }));
  await cz.settled();
  ok(cz.values.get(SKIN) === 2 && cz.values.get(HEAD_SKIN) === 2, "a record asking the skin the rig already wears keeps the head's copy at it");
  cz.renderAll();
  await cz.settled();
  ok(pixel(head.map) === COLOURS[2].join(), 'so the head renders in it again whatever renders it next');
}
{
  // The second asks for another skin: both go to it.
  const { c, cz, head } = await wornRig();
  applyAppearance(c as never, look({ [SKIN]: 2 }));
  await cz.settled();
  putBackLook(c as never, look({ [SKIN]: 1 }));
  applyAppearance(c as never, look({ [SKIN]: 1 }));
  await cz.settled();
  ok(cz.values.get(SKIN) === 1 && cz.values.get(HEAD_SKIN) === 1 && pixel(head.map) === COLOURS[1].join(), "a record asking another skin puts it on the shared colour and the head's copy alike");
}

// ---------------------------------------------------------------- a look sent again renders only what moved
{
  const { c, cz } = await wornRig();
  const first = look({ [SKIN]: 2, [SHIRT_KEY]: 1 });
  applyAppearance(c as never, first);
  await cz.settled();
  const asked: string[][] = [];
  const setAll = cz.setAll.bind(cz);
  cz.setAll = (values: Record<string, number>) => {
    asked.push(Object.keys(values));
    setAll(values);
  };
  applyAppearance(c as never, look({ [SKIN]: 2, [SHIRT_KEY]: 2 }));
  ok(asked.length === 1 && asked[0].join() === SHIRT_KEY, `another player's look sent again with one colour moved sets that one alone, so only what reads it renders again (${asked.map((a) => a.join('+')).join(' / ')})`);
  applyAppearance(c as never, look({ [SKIN]: 2, [SHIRT_KEY]: 2 }));
  ok(asked.length === 1, 'and the same look once more sets nothing at all');
}

// ---------------------------------------------------------------- the game's own wiring of all this
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  /** The text of a method from its signature to its matching closing brace. */
  const method = (signature: string): string => {
    const at = main.indexOf(signature);
    if (at < 0) return '';
    const open = main.indexOf('{', at + signature.length - 1);
    let depth = 0;
    for (let i = open; i < main.length; i++) {
      if (main[i] === '{') depth++;
      else if (main[i] === '}' && --depth === 0) return main.slice(open, i + 1);
    }
    return '';
  };
  ok(/import \{[^}]*\bputBackLook\b[^}]*\} from '\.\/player\/look/.test(main), 'the game takes putBackLook from look.ts, where this test runs it');
  ok(/this\.queueHello\(\)/.test(method('private saveAppearance(): void {')), 'a colour or a slider changed sends a hello (saveAppearance queues one)');
  const hello = method('private helloNow(): Hello {');
  ok(/lookKeep\(\s*rig\.wornMeshes\(\)\s*\)/.test(hello) && /packLook\(\s*drawn,\s*c\.outfit \?\? \[\],\s*keep\s*\)/.test(hello), 'the hello carries only the shared colours and those of what is worn');
  // A garment's colour is its thing's and no longer in the record's look, so what goes out is read off
  // the live character, which already carries every thing's colour.
  ok(/values:\s*rig\.variableValues\(\)/.test(hello), "and those colours are read off the character as it is drawn, not the record's look");
  const figure = main.slice(main.indexOf('this.select.loadFigure ='), main.indexOf('this.select.weaponName ='));
  ok(/const look = await this\.recordLook\(c, character\);[\s\S]*putBackLook\(character, look\);\s*this\.applyAppearance\(character, look\)/.test(figure), "the select screen puts the rig back before this record's look goes on, its things' colours laid over it");
  const creator = method('private async openCreator(): Promise<void> {');
  ok(/putBackLook\(character, legacy\);\s*this\.applyAppearance\(character, legacy\)/.test(creator), 'and so does the creator, which reuses the last figure\'s rig when the species is the same');
}

console.log(`\n${passed} checks passed`);
