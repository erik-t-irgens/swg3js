// The leaf cards' rule (`src/world/cardRule.ts`), on the packs and in three's own program:
//
//   1. on the packs (SWG3JS_PACKS, else assets-private), every flora model ruled as it loads: every card material
//      ends drawn from its front and casting from both sides, no flora material ends glass, blended or with vertex
//      colours, an opaque one keeps its sides; a placed model's material named in the card table is ruled the same
//      way and one that is not is left alone; where a pack carries the flora command's table, it equals the GLBs'
//      own `extras.swgCard` and every card takes its class from the GLB; and, world by world in a fresh session,
//      every placed model wearing any world's flora card shader is known as its own world loads (by the table
//      beside the packs, `flora-cards.json` or SWG3JS_FLORA_CARDS, and the world's own), once the packs carry them;
//   2. the injection's text, through the very hook chain `World.adoptMaterials` builds (the cascades' hook, the wet
//      look, the highlight, then the rule): its anchors are three 0.185's and the wet look's own, every name it uses
//      is declared before it, no name is declared twice in one scope, a wet card takes no gloss or sheen and its
//      sheen's Fresnel reads whichever face is drawn, and wrapping twice adds nothing;
//   3. the table: a pack's own class wins over a name's guess, and the knobs move only uniforms.
//
// Run: node tools/swg/tests/cardRule.test.ts
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { classByName } from '../../../src/world/cardAlpha.ts';
import { CARD_ALPHA, CARD_HOOK, CARD_PARS, CARD_SPEC_FILM, CARD_TUNE, CARD_UNIFORMS, CARD_WET_FRES, CARD_WET_GLOSS, CARD_WET_SHEEN, applyCard, forgetCardShaders, isCardShader, prepareCardModel, registerPackCards, registerSharedCards, setCardTune } from '../../../src/world/cardRule.ts';
import { wrapsOn, type Wrappable } from '../../../src/world/compileHooks.ts';
import { applySpec } from '../../../src/world/specular.ts';
import { WET_FLIP_LINE, WET_FRES_LINE, WET_GLOSS_LINE, WET_SHEEN_LINE, applyWetness } from '../../../src/world/wetness.ts';
import { floraPacks, glbJsonOf, glbScenes, isCardJson } from './glbThree.ts';
import { glslVariant, redeclared } from './glslScan.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));
/** The cut-out and blended materials' names in a GLB, read off its JSON chunk alone (thousands of placed models are read). */
function cardNamesOf(file: string): string[] {
  if (!file.toLowerCase().endsWith('.glb') || !existsSync(file)) return [];
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(20);
    if (readSync(fd, head, 0, 20, 0) < 20 || head.readUInt32LE(0) !== 0x46546c67) return [];
    const json = Buffer.alloc(head.readUInt32LE(12));
    readSync(fd, json, 0, json.length, 20);
    const doc = JSON.parse(json.toString('utf8')) as { materials?: Parameters<typeof isCardJson>[0][] };
    return (doc.materials ?? []).filter((m) => isCardJson(m)).map((m) => (m as { name?: string }).name ?? '');
  } catch {
    return [];
  } finally {
    closeSync(fd);
  }
}
const materialsOf = (o: THREE.Object3D): THREE.MeshStandardMaterial[] => {
  const m = (o as THREE.Mesh).material;
  return (Array.isArray(m) ? m : m ? [m] : []) as THREE.MeshStandardMaterial[];
};

// ---------------------------------------------------------------- 1. the packs

{
  const packs = floraPacks(PACKS);
  if (!packs.length) console.log(`skip the packs: no pack with flora under ${PACKS}`);
  else {
    let cards = 0;
    let opaque = 0;
    let wrongSide = 0;
    let glassy = 0;
    let coloured = 0;
    let opaqueMoved = 0;
    let fromGlb = 0;
    let tableChecked = 0;
    const tableWrong: string[] = [];
    const names = new Set<string>();
    for (const p of packs) {
      // The pack's own table, where it has one: equal to its GLBs' own extras, material by material.
      const table = p.manifest.cards;
      for (const d of p.manifest.categories.flora) {
        const file = join(p.dir, d.file);
        if (!existsSync(file)) continue;
        const json = glbJsonOf(file);
        for (const m of json.materials ?? []) {
          if (!isCardJson(m)) continue;
          names.add(m.name ?? '');
          if (!table) continue;
          tableChecked++;
          const own = m.extras?.swgCard as { blend?: boolean; emissive?: number[] } | undefined;
          const row = table[m.name ?? ''];
          if (!own || !row || own.blend !== row.blend || JSON.stringify(own.emissive) !== JSON.stringify(row.emissive)) tableWrong.push(`${p.pack}/${m.name}`);
        }
        const { scenes } = glbScenes(file);
        const sidesBefore = new Map<THREE.Material, { side: THREE.Side; transparent: boolean }>();
        for (const s of scenes) s.traverse((o) => materialsOf(o).forEach((m) => sidesBefore.set(m, { side: m.side, transparent: m.transparent })));
        prepareCardModel(scenes, { flora: true, count: false });
        for (const s of scenes) {
          s.traverse((o) => {
            for (const m of materialsOf(o)) {
              if (m.userData.swgCardBlend !== undefined) {
                cards++;
                if (m.side !== THREE.FrontSide || m.shadowSide !== THREE.DoubleSide) wrongSide++;
                if (m.userData.swgCardFrom === 'glb') fromGlb++;
              } else {
                opaque++;
                const b = sidesBefore.get(m);
                if (b && (b.side !== m.side || b.transparent !== m.transparent)) opaqueMoved++;
              }
              if (m.transparent || m.userData.glass) glassy++;
              if (m.vertexColors) coloured++;
            }
          });
        }
      }
    }
    ok(cards > 300, `every flora pack's cards were ruled as their models load (${cards} card materials over ${packs.length} packs)`);
    ok(wrongSide === 0, 'every flora card is drawn from its front and casts from both sides');
    ok(glassy === 0 && coloured === 0, `no flora material ends glass, blended or with vertex colours (${glassy} glassy, ${coloured} coloured)`);
    ok(opaque > 100 && opaqueMoved === 0, `an opaque flora material keeps its sides and stays opaque (${opaque} of them)`);
    if (tableChecked) {
      ok(tableWrong.length === 0, `each pack's \`cards\` table equals its GLBs' own extras.swgCard (${tableChecked} card materials)${tableWrong.length ? `: ${tableWrong.slice(0, 4).join(', ')}` : ''}`);
      ok(fromGlb > 0, `and a card takes its class from its GLB where the GLB says it (${fromGlb})`);
    } else console.log('     (no pack here carries the flora command\'s `cards` table yet: the names stand in, and the table check waits for the reconversion)');
    // What the game knows of the card shaders as each world loads, in a fresh session (`AssetPack.load`): the table
    // of every world's beside the packs, then the world's own. Its flora's names are not counted, since a placed
    // model can load before the flora that wears its shader. Every placed model of the world that wears a flora card
    // shader (any world's: the names the flora GLBs carry) must be known then, or it is drawn as converted until a
    // world that plants its shader has been visited.
    const sharedFile = process.env.SWG3JS_FLORA_CARDS ?? join(PACKS, 'flora-cards.json');
    const shared = existsSync(sharedFile) ? JSON.parse(readFileSync(sharedFile, 'utf8')) : null;
    let crossModels = 0;
    let withTables = 0;
    const unknownAtLoad: string[] = [];
    for (const p of packs) {
      forgetCardShaders();
      const fromShared = registerSharedCards(shared);
      registerPackCards(p.manifest.cards);
      // A world whose flora plants no card still has a table of its own (empty).
      if (fromShared > 0 && p.manifest.cards) withTables++;
      // A model the world also plants loads as its flora (`AssetPack.defFor`), whose own cut-outs are its cards.
      const planted = new Set(p.manifest.categories.flora.map((d) => d.id));
      for (const d of p.manifest.categories.layout ?? []) {
        if (d.cells?.length || planted.has(d.id)) continue;
        const wears = cardNamesOf(join(p.dir, d.file)).filter((n) => names.has(n));
        if (!wears.length) continue;
        crossModels++;
        const missing = wears.filter((n) => !isCardShader(n));
        if (missing.length) unknownAtLoad.push(`${p.pack}/${d.id} (${missing[0]})`);
      }
    }
    if (withTables === packs.length) ok(unknownAtLoad.length === 0, `every placed model wearing a flora card shader is known as its own world loads, in a fresh session (${crossModels} models over ${packs.length} worlds${unknownAtLoad.length ? `; not: ${unknownAtLoad.slice(0, 4).join(', ')}` : ''})`);
    else console.log(`     (${unknownAtLoad.length} of the ${crossModels} placed models wearing a flora card shader would be drawn as converted in a fresh session: ${withTables} of ${packs.length} worlds have both the table beside the packs (${shared ? sharedFile : 'none here'}) and their own; the flora command writes both, and this check waits for them)`);
    // A placed model wearing a flora card shader, and one wearing a cut-out that is not one, with every world's
    // card shaders known (as the table beside the packs makes them).
    forgetCardShaders();
    registerPackCards(Object.fromEntries([...names].map((n) => [n, { blend: classByName(n) === 'blend', emissive: [0, 0, 0] }])));
    let placedRuled = 0;
    let placedLeft = 0;
    let placedChecked = 0;
    let placedWrong = 0;
    for (const p of packs) {
      for (const d of p.manifest.categories.layout ?? []) {
        if (placedChecked > 400 || d.cells?.length) continue;
        const file = join(p.dir, d.file);
        if (!existsSync(file)) continue;
        const json = glbJsonOf(file);
        if (!(json.materials ?? []).some((m) => isCardJson(m))) continue;
        placedChecked++;
        const { scenes } = glbScenes(file);
        prepareCardModel(scenes, { flora: false, count: false });
        for (const s of scenes) {
          s.traverse((o) => {
            for (const m of materialsOf(o)) {
              if (!(m.alphaTest > 0 || m.transparent || m.userData.swgCardBlend !== undefined)) continue;
              const named = isCardShader(m.name);
              const ruled = m.userData.swgCardBlend !== undefined;
              if (named !== ruled) placedWrong++;
              else if (ruled) {
                placedRuled++;
                if (m.side !== THREE.FrontSide || m.shadowSide !== THREE.DoubleSide || m.transparent) placedWrong++;
              } else {
                placedLeft++;
                if (m.side !== THREE.DoubleSide) placedWrong++;
              }
            }
          });
        }
      }
    }
    // A folder holding the flora alone (a pilot conversion) has no placed model to read.
    if (!placedChecked) console.log('     (no placed model with a cut-out on disk here: the placed check waits for a folder that has them)');
    else ok(placedWrong === 0, `a placed model's cut-out named in the card table is ruled as a planted one (${placedRuled}) and one that is not is left as converted (${placedLeft}), over ${placedChecked} placed models`);
  }
}

// ---------------------------------------------------------------- 2. the injection's text

type Shader = THREE.WebGLProgramParametersWithUniforms;
const lib = THREE.ShaderLib.physical;
const resolve = (s: string): string => s.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => {
  const chunk = (THREE.ShaderChunk as unknown as Record<string, string>)[name];
  if (chunk === undefined) throw new Error(`no chunk ${name}`);
  return resolve(chunk);
});
/** The world's chain: the cascades' hook (which replaces), the wet look, the highlight, the rule. */
function chained(wet: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ alphaTest: 0.5, map: new THREE.Texture() });
  m.onBeforeCompile = function cascades(shader: Shader) {
    shader.uniforms.CSM_cascades = { value: [] };
  };
  m.userData.swgSpec = { mode: 'none', color: [0, 0, 0], power: 0, mask: 'unmasked' };
  m.userData.swgCardBlend = 'blend';
  if (wet) applyWetness(m);
  applySpec(m, false);
  applyCard(m);
  return m;
}
const compiled = (m: THREE.Material): Shader => {
  const s = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) } as unknown as Shader;
  m.onBeforeCompile(s, null as unknown as THREE.WebGLRenderer);
  return s;
};
const count = (text: string, s: string) => text.split(s).length - 1;

{
  ok(lib.fragmentShader.includes('#include <alphatest_fragment>') && lib.vertexShader.includes('#include <beginnormal_vertex>'), "the rule's anchors are in three 0.185's physical program");
  const wet = compiled(chained(true));
  const dry = compiled(chained(false));
  const cutLine = 'float swgCardK = swgCardBlend > 0.5 ? uSwgCardMipScale : uSwgCardMipScalePunch;';
  ok(CARD_ALPHA.includes(cutLine) && count(wet.fragmentShader, '#include <alphatest_fragment>') === 0 && count(wet.fragmentShader, cutLine) === 1, "three's cut is replaced by the class's, once");
  ok(count(wet.fragmentShader, WET_GLOSS_LINE) === 0 && count(wet.fragmentShader, CARD_WET_GLOSS) === 1 && count(wet.fragmentShader, WET_FRES_LINE) === 0 && count(wet.fragmentShader, CARD_WET_FRES) === 1 && count(wet.fragmentShader, WET_SHEEN_LINE) === 0 && count(wet.fragmentShader, CARD_WET_SHEEN) === 1, 'a wet card takes its gloss and sheen by wetGloss, and its sheen\'s Fresnel from whichever face is drawn');
  ok(count(wet.fragmentShader, WET_FLIP_LINE) === 1, "the wet look's flip of a double-sided underside is there and left as it is (a front-drawn card never takes it; a split one needs it)");
  ok(count(wet.fragmentShader, CARD_SPEC_FILM) === 1, "and the highlight's film keeps a wet card matt by the same knob");
  ok(count(dry.fragmentShader, CARD_WET_GLOSS) === 0 && count(dry.fragmentShader, CARD_PARS.trim().split('\n')[0]) === 1, 'a card the wet look does not reach takes the rule without its wet lines');
  const scope = (src: string, defined: string[]) => redeclared(glslVariant(resolve(src), new Set(defined)));
  const base = ['USE_MAP', 'USE_ALPHATEST', 'USE_INSTANCING', 'STANDARD'];
  const variants = [base, [...base, 'SWG_WET'], [...base, 'SWG_CARD_LIGHT'], [...base, 'SWG_CARD_LIGHT', 'SWG_LEAF_SHADOW']];
  const twice = variants.flatMap((v) => [...scope(wet.fragmentShader, v), ...scope(wet.vertexShader, v)]);
  ok(twice.length === 0, `no name is declared twice in one scope, in any variant${twice.length ? `: ${twice.slice(0, 4).join(', ')}` : ''}`);
  const f = resolve(wet.fragmentShader);
  const used = [
    ['uniform float swgCardBlend;', 'swgCardBlend > 0.5'],
    ['uniform float uSwgCardMipScale;', 'uSwgCardMipScale :'],
    ['uniform float uSwgCardWetGloss;', 'wetSurface * uSwgCardWetGloss'],
    ['float wetSurface = 0.0;', CARD_WET_GLOSS],
  ];
  ok(used.every(([decl, use]) => f.indexOf(decl) >= 0 && f.indexOf(decl) < f.indexOf(use)), 'every name the rule uses is declared before it in the program three is handed');
  const v = resolve(wet.vertexShader);
  ok(v.indexOf('attribute vec4 cardPlane;') >= 0 && v.indexOf('attribute vec4 cardPlane;') < v.indexOf('swgCardPlane = cardPlane.xyz') && v.indexOf('vec3 objectNormal = vec3( normal );') < v.indexOf('swgCardPlane = cardPlane.xyz'), 'the vertex stage declares the plane before it reads it, and reads it after three makes objectNormal');
  const m = chained(true);
  const key = m.customProgramCacheKey();
  const hook = m.onBeforeCompile;
  applyCard(m);
  applyCard(m);
  ok(m.onBeforeCompile === hook && m.customProgramCacheKey() === key && wrapsOn(m as unknown as Wrappable).join('|') === 'wet-object|spec|card', `wrapping twice adds nothing, and the chain is the world's (${wrapsOn(m as unknown as Wrappable).join(' > ')})`);
  ok(Object.keys(compiled(m).uniforms).filter((k) => k.startsWith('uSwgCard')).every((k) => (compiled(m).uniforms[k] as unknown) === (CARD_UNIFORMS as Record<string, unknown>)[k]), 'every card hands three the shared knobs by reference, so one write reaches all of them');
  void CARD_HOOK;
}

// ---------------------------------------------------------------- 3. the table and the knobs

{
  registerPackCards({ 'shader/test_table_aa7.sht': { blend: false, emissive: [0.4, 0.4, 0.4] } });
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
  mat.name = 'shader/test_table_aa7.sht';
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat));
  prepareCardModel([g], { flora: false, count: false });
  ok(mat.userData.swgCardBlend === 'punch' && mat.userData.swgCardFrom === 'pack' && JSON.stringify(mat.userData.swgCardEmissive) === '[0.4,0.4,0.4]', "a pack's own class and emissive win over the name's guess (an _aa7 name the table says is cut out)");
  ok(typeof mat.userData.swgCardBlend === 'string' && Array.isArray(mat.userData.swgCardEmissive) && mat.userData.swg === undefined, 'and they are a string and a plain array, never under userData.swg');
  const was = { ...CARD_TUNE };
  setCardTune({ cutBlend: 0.4, mipScale: 0.2, wetGloss: 1, backs: 'stored' });
  ok(CARD_UNIFORMS.uSwgCardCutBlend.value === 0.4 && CARD_UNIFORMS.uSwgCardMipScale.value === 0.2 && CARD_UNIFORMS.uSwgCardWetGloss.value === 1 && CARD_UNIFORMS.uSwgCardBacksStored.value === 1, 'the live knobs move the shared uniforms');
  setCardTune(was);
  ok(CARD_UNIFORMS.uSwgCardCutBlend.value === was.cutBlend && CARD_UNIFORMS.uSwgCardBacksStored.value === 0, 'and back');
}

console.log(`\ncardRule: ${passed} checks passed`);
