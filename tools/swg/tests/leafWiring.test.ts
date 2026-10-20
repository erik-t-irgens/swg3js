// Where the game applies the leaf cards' rule, the mirror and the sway: the one place every model passes as it loads
// (`AssetPack.model`), and the calls round it that the rule's own tests never reach.
//
//   1. the real `AssetPack`, loaded through a stand-in for the network and for the GLTF loader, with a world whose
//      planted tree is also one it places (as Kashyyyk's wroshyrs are), a placed tree wearing a leaf shader only
//      another world plants, and a placed fence wearing a cut-out no table names:
//        - the planted tree loads the flora's own file and def, wherever it is asked for, and counts as flora;
//        - its leaves are ruled (drawn from the front, cast from both sides) and the whole tree is marked to sway;
//        - the placed tree is ruled and sways from the table of every world's card shaders beside the packs, before
//          any flora that wears the shader has loaded; the fence is left as converted and still;
//        - a pack's own `cards` table is known before its first model loads;
//        - with neither table, the placed tree is left as converted until a flora wearing its shader loads (the
//          packs before the leaf pass's conversion, which `status` asks to convert again);
//   2. the calls round it, read from their own text: a captured place's cards ruled before it is adopted and stood,
//      the card rule and the sway wrapped after the highlight in `adoptMaterials` with the sway depth material hung
//      there, the flora's cast and receive rules, and a building's rooms pass putting the card light and the sway
//      on the rooms' footing.
//
// Run: node tools/swg/tests/leafWiring.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { AssetPack, type PackManifest } from '../../../src/world/assetPack.ts';
import { forgetCardShaders } from '../../../src/world/cardRule.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ---------------------------------------------------------------- 1. a pack, loaded

const LEAF = 'shader/test_wiring_leaf_ap10.sht';
const FAR_LEAF = 'shader/test_wiring_far_leaf_ap10.sht';
const OWN_LEAF = 'shader/test_wiring_own_leaf_aa7.sht';
const FENCE = 'shader/test_wiring_fence_ap10.sht';
const BARK = 'shader/test_wiring_bark.sht';
const bounds = { min: [-2, 0, -2], max: [2, 8, 2] };

/** A model as GLTFLoader hands one over: a trunk and, where named, a cut-out card sheet (both sides drawn, as converted). */
function gltfOf(card: string | null): { scene: THREE.Group; scenes: THREE.Group[] } {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 5), Object.assign(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), { name: BARK })));
  if (card) {
    const leaf = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), alphaTest: 0.5, side: THREE.DoubleSide });
    leaf.name = card;
    const g = new THREE.PlaneGeometry(3, 3);
    g.translate(0, 6, 0);
    scene.add(new THREE.Mesh(g, leaf));
  }
  return { scene, scenes: [scene] };
}
const materialsOf = (root: THREE.Object3D): THREE.MeshStandardMaterial[] => {
  const out: THREE.MeshStandardMaterial[] = [];
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) out.push(...((Array.isArray(m) ? m : [m]) as THREE.MeshStandardMaterial[]));
  });
  return out;
};
const named = (root: THREE.Object3D, name: string) => materialsOf(root).find((m) => m.name === name)!;

/** The network as the dev server answers it: the files given, everything else missing. */
function serve(files: Record<string, unknown>): void {
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    const body = Object.prototype.hasOwnProperty.call(files, url) ? files[url] : undefined;
    // `text` as well: a pack's manifest is read as text since the performance pass's fifth wave (`manifestText`).
    return body === undefined ? { ok: false, status: 404, headers: { get: () => 'text/html' }, json: async () => null, text: async () => '' } : { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body) };
  };
}

/** A pack loaded as the world loads one, its models handed over by a stand-in for the GLTF loader that keeps every file asked for. */
async function packOf(site: string, manifest: PackManifest, shared: unknown): Promise<{ pack: AssetPack; asked: string[] }> {
  const files: Record<string, unknown> = { [`${site}assets-private/testworld/manifest.json`]: manifest };
  if (shared) files[`${site}assets-private/flora-cards.json`] = shared;
  serve(files);
  forgetCardShaders();
  const pack = await AssetPack.load('testworld', site);
  assert.ok(pack, 'the pack loads');
  const asked: string[] = [];
  const cards: Record<string, string | null> = { 'tree.glb': LEAF, 'flora/tree.glb': LEAF, 'placedtree.glb': FAR_LEAF, 'owntree.glb': OWN_LEAF, 'fence.glb': FENCE };
  (pack as unknown as { loader: { loadAsync: (url: string) => Promise<unknown> } }).loader = {
    loadAsync: async (url: string) => {
      asked.push(url);
      const file = url.slice(`${site}assets-private/testworld/`.length);
      return gltfOf(cards[file] ?? null);
    },
  };
  return { pack, asked };
}

const layoutTree = { id: 'tree', file: 'tree.glb', bounds, source: 'appearance/tree.apt', parts: 1 };
const floraTree = { id: 'tree', file: 'flora/tree.glb', bounds, appearance: 'appearance/tree.apt', family: 1, familyName: 'trees' };
const world = (cards?: PackManifest['cards']): PackManifest =>
  ({
    planet: 'testworld',
    categories: {
      layout: [layoutTree, { id: 'placedtree', file: 'placedtree.glb', bounds }, { id: 'owntree', file: 'owntree.glb', bounds }, { id: 'fence', file: 'fence.glb', bounds }],
      flora: [floraTree],
    },
    ...(cards ? { cards } : {}),
  }) as unknown as PackManifest;
const sharedTable = { version: 1, cards: { [LEAF]: { blend: false, emissive: [0, 0, 0] }, [FAR_LEAF]: { blend: false, emissive: [0, 0, 0] } } };

{
  // With the table beside the packs: the placed tree first, before any flora that wears its leaf has loaded.
  const { pack, asked } = await packOf('/with-table/', world(), sharedTable);
  const placed = await pack.model('placedtree');
  const far = named(placed.scene, FAR_LEAF);
  ok(far.userData.swgCardBlend === 'punch' && far.userData.swgCardFrom === 'pack' && far.side === THREE.FrontSide && far.shadowSide === THREE.DoubleSide, "a placed tree wearing a leaf only another world plants is ruled from the table beside the packs, loaded before any flora of this world");
  ok(typeof far.userData.swgSway === 'string' && typeof named(placed.scene, BARK).userData.swgSway === 'string', 'and sways, trunk and leaves alike');
  const tree = await pack.model('tree');
  ok(asked.includes('/with-table/assets-private/testworld/flora/tree.glb') && !asked.includes('/with-table/assets-private/testworld/tree.glb'), 'a planted tree the world also places loads the flora\'s own file (its leaves bled, their class stamped)');
  ok(tree.def.file === floraTree.file && (tree.def as { appearance?: string }).appearance === floraTree.appearance, 'and its flora def, whose collision shapes the flora carries');
  ok(pack.isFlora(pack.find('tree')!) && pack.find('tree')!.file === 'tree.glb', 'and counts as flora by its id, even asked for by its placed entry');
  const leaf = named(tree.scene, LEAF);
  ok(leaf.side === THREE.FrontSide && leaf.shadowSide === THREE.DoubleSide && typeof leaf.userData.swgSway === 'string' && typeof named(tree.scene, BARK).userData.swgSway === 'string', 'its leaves are ruled and the whole tree sways');
  const fence = await pack.model('fence');
  const f = named(fence.scene, FENCE);
  ok(f.userData.swgCardBlend === undefined && f.side === THREE.DoubleSide && f.userData.swgSway === undefined, 'a placed cut-out no table names is left as converted, and still');
}

{
  // A pack's own table, with nothing beside the packs: known before its first model loads.
  const { pack } = await packOf('/own-table/', world({ [OWN_LEAF]: { blend: true, emissive: [0.2, 0.2, 0.2] } }), null);
  const own = named((await pack.model('owntree')).scene, OWN_LEAF);
  ok(own.userData.swgCardBlend === 'blend' && own.userData.swgCardFrom === 'pack' && JSON.stringify(own.userData.swgCardEmissive) === '[0.2,0.2,0.2]', "a pack's own cards table is known before its first model loads");
}

{
  // Neither table (packs converted before the leaf pass): the placed tree waits on a flora wearing its leaf.
  const { pack } = await packOf('/no-table/', world(), null);
  const before = named((await pack.model('placedtree')).scene, FAR_LEAF);
  ok(before.userData.swgCardBlend === undefined && before.side === THREE.DoubleSide, "with neither table a placed tree wearing a leaf no flora here has loaded yet is left as converted (what `status`'s call for the flora's conversion mends)");
  const leaf = named((await pack.model('tree')).scene, LEAF);
  ok(leaf.userData.swgCardBlend !== undefined && leaf.userData.swgCardFrom === 'names', "while the flora's own leaves are ruled by their names");
}

// ---------------------------------------------------------------- 2. the calls round it

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../src/${rel}`, import.meta.url)), 'utf8');
{
  const asset = read('world/assetPack.ts');
  const load = asset.slice(asset.indexOf('static async load('), asset.indexOf('category(name: string)'));
  ok(load.indexOf('await loadSharedCards(base);') >= 0 && load.indexOf('await loadSharedCards(base);') < load.indexOf('registerPackCards(manifest.cards);') && load.indexOf('registerPackCards(manifest.cards);') < load.indexOf('new AssetPack('), "a pack's load knows every world's card shaders, then its own, before the pack exists");
  const model = asset.slice(asset.indexOf('  model(id: string)'), asset.indexOf('/** A model that has already finished loading'));
  ok(model.includes('const def = this.defFor(id);') && model.indexOf('prepareCardModel(scenes, { flora }') >= 0 && model.indexOf('prepareCardModel(scenes, { flora }') < model.indexOf('prepareSwayModel(scenes,') && model.includes('const scenes = [gltf.scene, ...') && model.includes('const flora = this.isFlora(def);'), 'a model loads by its flora def where it has one, its own scene first, the card rule before the sway');
  const w = read('world/world.ts');
  const place = w.slice(w.indexOf('  preparePlace('), w.indexOf('  preparePlace(') + 400);
  ok(place.indexOf('prepareCardModel([s.root], { flora: false }') >= 0 && place.indexOf('prepareCardModel([s.root]') < place.indexOf('this.adoptMaterials(group);'), "a captured place's cards are ruled before its materials are adopted");
  const main = read('main.ts');
  const show = main.slice(main.indexOf('private async showScene('), main.indexOf('private async showScene(') + 6000);
  ok(show.includes('defer: true') && show.indexOf('this.world.loadPack(stand)') < show.indexOf('this.world.preparePlace(built.sources, built.group);') && show.indexOf('this.world.preparePlace(built.sources, built.group);') < show.indexOf('this.world.scene.add(built.group);'), 'and only once its world\'s pack is in, before it is stood in the scene');
  const adopt = w.slice(w.indexOf('  adoptMaterials(root: THREE.Object3D)'), w.indexOf('  adoptMaterials(root: THREE.Object3D)') + 4500);
  const at = (s: string) => adopt.indexOf(s);
  ok(at('if (m.userData.swgSpec) specWrap(m);') > 0 && at('if (m.userData.swgSpec) specWrap(m);') < at('if (m.userData.swgCardBlend !== undefined) cardWrap(m);') && at('cardWrap(m);') < at('if (m.userData.swgSway !== undefined) swayWrap(m);'), 'adoptMaterials wraps the card rule after the highlight and the sway after the card rule');
  ok(at('if (mesh.material.userData.swgSway !== undefined) hangSwayDepth(mesh);') > at('swayWrap(m);'), 'and hangs a swaying mesh\'s depth material there, before it ever casts');
  const batch = read('world/floraBatch.ts');
  const flora = read('world/flora.ts');
  ok((batch.match(/castShadow = cast && castsShadow\(mesh\.material\)|const want = cast && castsShadow\(mesh\.material\)/g) ?? []).length === 2 && (batch.match(/cardReceives\(mesh\.material, b\.big\)/g) ?? []).length === 2, "the flora's batches cast by the material as well as the casters' rule, and receive by the cards' rule at their size");
  const planted = flora.slice(flora.indexOf('export function plantedShadow('), flora.indexOf('export function plantedShadow(') + 700);
  ok(planted.includes('const cast = floraCasts(size, 0) && castsShadow(material);') && planted.includes('const receive = cardReceives(material, floraBig(size));') && /mesh\.userData\.casterSize = model\.radius \* Math\.max\(\.\.\.list\.map\(\(p\) => p\.scale\)\);\s*plantedShadow\(mesh\);/.test(flora), "and so do a chunk's own meshes, stamped with their size as they are planted and ruled by the one function the world walks them with");
  ok(/applyFloraCasters\(\): number \{\s*this\.floraField\?\.applyShadows\(\);[\s\S]{0,200}for \(const g of \[c\.trees, c\.plants\]\) \{[\s\S]{0,120}if \(\(o as THREE\.Mesh\)\.isMesh && plantedShadow\(o as THREE\.Mesh\)\) casting\+\+;/.test(w), "and a switch moved walks every chunk's trees and plants through that function, and the region batches through theirs");
  const portal = read('world/portalRender.ts');
  const rooms = portal.slice(portal.indexOf('private renderRooms('), portal.indexOf('private renderRooms(') + 1100);
  ok(rooms.indexOf('this.roomPass(true);') >= 0 && rooms.indexOf('this.roomPass(true);') < rooms.indexOf('this.renderLayer(this.passScenes.forRooms(scene), camera, INTERIOR_LAYER);') && rooms.indexOf('this.roomPass(false);') > rooms.indexOf('finally'), "a building's rooms pass is told it has begun and, whatever happens, that it has ended");
  ok(w.includes('portals.roomPass = roomPassLeaves;') && /function roomPassLeaves\(on: boolean\): void \{\s*setCardRoomPass\(on\);\s*setSwayRoomPass\(on\);/.test(w), 'and the world hands it the cards\' light and the sway, so a plant standing in a room takes its lamps and no wind');
}

console.log(`\nleafWiring: ${passed} checks passed`);
