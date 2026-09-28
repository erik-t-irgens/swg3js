// The model memory budget over looks that share their pieces, on the asset cache itself
// (src/world/mobiles/assets.ts): what it holds in all, what is referenced, what a trim gives back, what
// standing a look again costs, what putting several bodies down together gives back, and what the next
// look of a body is estimated at. Every figure the 180 MB budget is read by counts a shared piece once.
//
// The cache is driven for real, from `acquireModel` through `buildLook` and `shareLook`. Only the parts
// character underneath is a stand-in, since it loads GLB files and decodes their pictures: it hands back
// a body and a shirt out of the same two part files for every look, each with textures of its own that
// the share then swaps for the first look's, and a picture no part file carried, which stays the look's
// own. The stand-in is served in place of `character.ts` by a resolve hook, as moods.test.ts does.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

const charStub = 'export class Character { static load(...a) { return globalThis.__characterLoad(...a); } }';
const hook = `export async function resolve(s, c, next) {
  if (s.endsWith('/player/character.ts') || s.endsWith('/player/character')) {
    return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(charStub)}), shortCircuit: true };
  }
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { MobileAssets } = await import('../../../src/world/mobiles/assets.ts');
const { LOOK_SHARE, geometryBytes, textureBytes } = await import('../../../src/world/mobiles/lookShare.ts');
type LookSources = import('../../../src/world/mobiles/lookShare.ts').LookSources;
type ModelAsset = import('../../../src/world/mobiles/assets.ts').ModelAsset;
type MobileEntry = import('../../../src/world/mobiles/types.ts').MobileEntry;
type MobileCatalogue = import('../../../src/world/mobiles/catalogue.ts').MobileCatalogue;

let passed = 0;
/** Two byte counts that are the same sum taken in another order. */
const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ------------------------------------------------------------------ the stand-in body
function tex(w: number, h: number): THREE.Texture {
  const t = new THREE.Texture();
  t.image = { width: w, height: h };
  return t;
}
function quad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 30), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
/** Everything every look has made of its own, whether the share kept it or dropped it: what a disposal is checked against. */
const made = { textures: [] as THREE.Texture[], geometries: [] as THREE.BufferGeometry[] };
/** Built the way the parts character leaves a look: meshes from two files, their part textures, and one picture of the look's own. */
(globalThis as unknown as { __characterLoad: unknown }).__characterLoad = async (_base: string, _id: string, _wear: string[] | undefined, opts: { dir: string }) => {
  const root = new THREE.Group();
  const body = new THREE.Mesh(quad(), new THREE.MeshStandardMaterial({ name: 'shader/body.sht', map: tex(128, 128), normalMap: tex(128, 128) }));
  const shirt = new THREE.Mesh(quad(), new THREE.MeshStandardMaterial({ name: 'shader/shirt.sht', map: tex(64, 64), alphaMap: tex(128, 128) }));
  root.add(body, shirt);
  const b = body.material as THREE.MeshStandardMaterial;
  const s = shirt.material as THREE.MeshStandardMaterial;
  made.textures.push(b.map!, b.normalMap!, s.map!, s.alphaMap!);
  made.geometries.push(body.geometry, shirt.geometry);
  const meshes = new Map<THREE.Mesh, { file: string; index: number }>([
    [body, { file: 'body.glb', index: 0 }],
    [shirt, { file: 'shirt.glb', index: 0 }],
  ]);
  // The shirt's alpha picture is no part file's: it stays the look's own.
  const textures = new Map<THREE.Texture, string>([
    [b.map!, 'png|body|srgb'],
    [b.normalMap!, 'png|body_n|'],
    [s.map!, 'png|shirt|srgb'],
  ]);
  const sources: LookSources = { root, skeleton: opts.dir, meshSource: (m) => meshes.get(m) ?? null, textureSource: (t) => textures.get(t) ?? null };
  return { group: root, customizer: null, setMorph() {}, async wearItemFrom() { return true; }, lookSources: () => sources };
};
const cat = { modelFile: () => null, appearanceOf: () => null, packOf: () => null } as unknown as MobileCatalogue;
const entry = (id: string, species = 'human_male'): MobileEntry => ({ id, name: id, kind: 'dressed', species, outfit: [] }) as unknown as MobileEntry;
const assets = MobileAssets.for('test://lookBudget/');
const acquire = (e: MobileEntry): Promise<ModelAsset> => assets.acquireModel(MobileAssets.modelKey(e, cat)!, { hologram: false, look: { entry: e, cat } });

// ------------------------------------------------------------------ two looks out, sharing
const shared = textureBytes(tex(128, 128)) * 2 + textureBytes(tex(64, 64)) + geometryBytes(quad()) * 2;
const own = textureBytes(tex(128, 128));
const A = await acquire(entry('a'));
ok(A.refs === 1 && same(A.bytes, own), `a look's own bytes are only what is its alone: the picture no part file carried (${A.bytes})`);
ok(same(assets.shared.bytes(), shared) && same(assets.referencedBytes(), own + shared), 'its part textures and geometry are counted by the share, and referenced while it is out');
const B = await acquire(entry('b'));
const s = assets.stats();
ok(same(B.bytes, own) && same(assets.shared.bytes(), shared), 'a second look of the same body adds only its own picture: the share counts the body once');
ok(B.meshes[0].geometry === A.meshes[0].geometry && B.meshes[0].geometry !== made.geometries[2] && (B.materials[0] as THREE.MeshStandardMaterial).map === (A.materials[0] as THREE.MeshStandardMaterial).map, 'it wears the first look\'s body geometry and textures, not the copies it was built with');
// (The console's figures are whole bytes.)
ok(s.bytes === Math.round(2 * own + shared) && s.referenced === Math.round(2 * own + shared), `in all and referenced, each shared piece once (${s.referenced} of ${Math.round(2 * own + shared)})`);
ok(s.shared.looks.out === 2 && s.models.find((m) => m.key === A.key)!.shared === Math.round(shared), 'both looks are out, each wearing the whole of the shared pieces');

// ------------------------------------------------------------------ the next look's estimate
const folder = 'characters/human_male/';
const measured = s.shared.uniqueShare[folder];
const whole = own + shared;
ok(Math.abs(measured - own / whole) < 0.01, `the second look, built while the first was out, measures what standing it added: its own picture of the whole (${measured} against ${(own / whole).toFixed(2)})`);
{
  const next = entry('c');
  LOOK_SHARE.on = false;
  const alone = assets.estimate(next, cat).model;
  LOOK_SHARE.on = true;
  const sharing = assets.estimate(next, cat).model;
  ok(Math.abs(sharing / alone - own / whole) < 1e-9, 'and the next look of that body is estimated at that share of a whole one while its body is out');
  ok(same(assets.wouldCost(next, cat), sharing), 'which is what standing it is taken to cost');
}

// ------------------------------------------------------------------ what putting bodies down gives back
{
  const tally = assets.freeTally;
  tally.reset();
  const alone = tally.add(A, null);
  ok(same(alone, own), 'putting the first look\'s body down alone gives back its own picture and nothing the second still wears');
  const both = tally.add(B, null);
  ok(same(both, 2 * own + shared), `putting both down gives back the body they share as well (${both}), which neither gives back alone`);
  // A look worn by two bodies: the model goes with the second of them.
  const A2 = await acquire(entry('a'));
  ok(A2 === A && A.refs === 2, 'a second body of the first look holds the same asset');
  tally.reset();
  ok(tally.add(A, null) === 0 && same(tally.add(A, null), own), 'and one of its bodies gives back nothing, both its own picture');
  assets.release(A);
}

// ------------------------------------------------------------------ one look put down, then both, then a trim
{
  assets.release(A);
  ok(A.refs === 0 && same(assets.referencedBytes(), own + shared), 'the first look put down: the share is still referenced, for the second');
  ok(same(assets.wouldCost(entry('a'), cat), own), 'and standing it again from the cache costs only its own picture');
  const counted = (o: THREE.EventDispatcher<{ dispose: object }>) => {
    const c = { n: 0 };
    o.addEventListener('dispose', () => c.n++);
    return c;
  };
  // The first look's textures (its body's two and its shirt's, all shared, then its own picture) and its
  // two geometries, both shared.
  const aGone = made.textures.slice(0, 4).map(counted);
  const aGeo = made.geometries.slice(0, 2).map(counted);
  const t1 = assets.trim(assets.stats().bytes - own);
  ok(t1.disposed === 1 && same(t1.bytes, own) && same(assets.shared.bytes(), shared), `a trim that takes the first look gives back its own picture and leaves every shared piece to the second (${t1.bytes})`);
  ok(aGone[3].n === 1 && aGone[0].n === 0 && aGone[1].n === 0 && aGone[2].n === 0, 'its own picture is disposed, and the shared textures it wore are not');
  ok(aGeo.every((c) => c.n === 0), 'nor the shared geometry it wore, which the second still draws');
  assets.release(B);
  ok(assets.referencedBytes() === 0 && same(assets.wouldCost(entry('b'), cat), own + shared), 'the second put down: nothing is referenced, and standing it again would cost it all');
  const t2 = assets.trim(0);
  ok(t2.disposed === 1 && same(t2.bytes, own + shared) && assets.stats().bytes === 0 && assets.shared.bytes() === 0, `a trim to nothing takes the last look and every shared piece with it (${t2.bytes})`);
  ok(aGone.every((c) => c.n === 1) && aGeo.every((c) => c.n === 1), 'every piece the first look brought is disposed once, the shared ones with the last look to wear them');
}

console.log(`\n${passed} checks passed`);
