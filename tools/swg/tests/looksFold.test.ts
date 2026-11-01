// A permanent row's looks on the real streamer (Map-maker II's seventh wave, `streamHarness.ts`): rows filed before their
// tier loads fold into its bulk grouped by their model and their look's signature -- the plain ones exactly as before, a
// tinted group in the tint's copy, a borrowed picture's group in a copy wearing the donor's picture (the donor's model
// loaded with the tier, though nothing of the tier stands as it), a borrowed material's group in the donor's material under
// the piece's own name, a look the donor cannot give refused in words and worn as the piece's own -- every copy shared by
// every row wearing it; a looked row stood after its tier wears its copy on meshes of its own and lets it go when taken
// away (kept as a spare, and worn again as the very copy when it is stood again); the tier's still casters, copies and
// all, go into its shadow batch; the streamer going lets go of every copy its tiers held, and the world going forgets every
// copy before it disposes it, never a texture; a borrowed picture or material whose donor's model was not loaded when its
// tier split takes the runtime path, which loads it, as does one stood after its tier. And with no look at all, the scene
// the streamer builds over permanent rows is a70487c's own to the last matrix element (its streamer loaded out of git, or
// its scene's hash recorded here where git cannot hand it over).
//
// Run: node tools/swg/tests/looksFold.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The harness first: it stands a stub in for the particle player before anything loads the streamer.
const { makeStreamer, loadedOf, boxGeo, THREE } = await import('./streamHarness.ts');
const { ShadowBatches, batchable } = await import('../../../src/world/shadowBatches.ts');
const { RowMaterials } = await import('../../../src/world/rowMaterials.ts');

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
/** Where the wave began: main when Map-maker II's seventh wave started. */
const PRE_WAVE = 'a70487c';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const named = (name: string, map: THREE.Texture | null, color = 0xffffff): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({ color });
  m.name = name;
  if (map) m.map = map;
  return m;
};
let texturesDisposed = 0;
const tex = (): THREE.Texture => {
  const t = new THREE.Texture();
  t.addEventListener('dispose', () => texturesDisposed++);
  return t;
};
// A lamp of two pieces (its body, which draws a picture, and its glass) and a sign whose face lends its picture or itself.
const LAMP = { id: 'lamp', file: 'lamp.glb', bounds: { min: [-0.5, 0, -0.5], max: [0.5, 2, 0.5] }, triangles: 24 };
const SIGN = { id: 'sign', file: 'sign.glb', bounds: { min: [-1, 0, -0.1], max: [1, 1, 0.1] }, triangles: 12 };
const bodyMat = named('body', tex(), 0x808080);
const glassMat = named('glass', null);
const faceMat = named('face', tex());
function lampModel() {
  return loadedOf(LAMP, [
    { geometry: boxGeo(1, 1.5, 1, 0), cell: -1, material: bodyMat },
    { geometry: boxGeo(0.6, 0.5, 0.6, 1.5), cell: -1, material: glassMat },
  ]);
}
const signModel = () => loadedOf(SIGN, [{ geometry: boxGeo(2, 1, 0.2, 0), cell: -1, material: faceMat }]);

type H = Awaited<ReturnType<typeof makeStreamer>>;
const placed = (h: H, key: string) => h.s.placedByKey.get(key);
const stand = (h: H, key: string, model: string, x: number, z: number, mats?: unknown) =>
  h.stream.standPermanent({ key, model, x, y: 0, z, q: [0, 0, 0, 1], inside: false, solid: true, ...(mats ? { mats } : {}) } as never, h.s.pack);

// ---- 1. Rows folded by their look. ----
const forgotten: THREE.Material[] = [];
const disposed: THREE.Material[] = [];
const looks = new RowMaterials({
  forget: (ms) => {
    for (const m of ms) forgotten.push(m);
  },
});
const h = await makeStreamer(undefined, { defs: [LAMP, SIGN], models: { lamp: lampModel(), sign: signModel() } });
h.s.looks = looks;
const sb = new ShadowBatches(h.scene);
h.stream.shadowBatches = sb;
const TINT = [{ of: 'body', tint: '#ff0000' }];
for (let i = 0; i < 3; i++) stand(h, `place/plain${i}`, 'lamp', 40 + i * 2, 40);
for (let i = 0; i < 2; i++) stand(h, `place/red${i}`, 'lamp', 40 + i * 2, 44, TINT);
stand(h, 'place/pic', 'lamp', 40, 48, [{ of: 'body', map: 'tatooine:sign/face' }]);
stand(h, 'place/like', 'lamp', 44, 48, [{ of: 'glass', like: 'tatooine:sign/face' }]);
stand(h, 'place/refused', 'lamp', 48, 48, [{ of: 'body', like: 'nowhere:x/y' }]);
await h.settle({ x: 44, z: 44 }, 30);
const meshesOf = (key: string): THREE.InstancedMesh[] => {
  const r = h.s.foldOf.get(placed(h, key));
  return r ? r.slots.map((s: { mesh: THREE.InstancedMesh }) => s.mesh) : [];
};
const matOf = (key: string, name: string): THREE.Material | null => {
  for (const m of meshesOf(key)) {
    const mat = m.material as THREE.Material;
    if (mat.name === name) return mat;
  }
  return null;
};
{
  const keys = ['place/plain0', 'place/plain1', 'place/plain2', 'place/red0', 'place/red1', 'place/pic', 'place/like', 'place/refused'];
  ok(keys.every((k) => !!h.s.foldOf.get(placed(h, k)) && !h.s.runtime.get(placed(h, k))), `every row filed before its tier loaded is folded into the bulk, looks and all (${keys.length} rows)`);
  const plainBody = meshesOf('place/plain0').find((m) => (m.material as THREE.Material).name === 'body')!;
  ok(plainBody.material === bodyMat && plainBody.count === 3 && meshesOf('place/plain2').includes(plainBody), 'the plain rows are one instanced mesh a piece, in the pieces\' own materials, as before');
  const red = matOf('place/red0', 'body') as THREE.MeshStandardMaterial;
  ok(!!red && red !== bodyMat && looks.isCopy(red) && red.color.equals(new THREE.Color(0x808080).multiply(new THREE.Color('#ff0000'))) && red.map === bodyMat.map, "the tinted rows' body wears the tint's copy (its colour times the tint, its own picture)");
  ok(matOf('place/red1', 'body') === red && meshesOf('place/red0')[0].count === 2 && matOf('place/red0', 'glass') === glassMat, 'one copy for both, in one mesh of two, their glass their own');
  const pic = matOf('place/pic', 'body') as THREE.MeshStandardMaterial;
  ok(!!pic && looks.isCopy(pic) && pic.map === faceMat.map && pic.color.equals(bodyMat.color), "a borrowed picture's row wears a copy with the donor's picture: the donor's model was loaded with the tier");
  const like = matOf('place/like', 'glass') as THREE.MeshStandardMaterial;
  ok(!!like && looks.isCopy(like) && like.map === faceMat.map && like.name === 'glass' && matOf('place/like', 'body') === bodyMat, "a borrowed material's row wears the donor's material under the piece's own name, its other piece its own");
  ok(matOf('place/refused', 'body') === bodyMat && looks.notes.some((n) => /nowhere:x\/y/.test(n)), 'a look its donor cannot give is refused in words and the piece wears its own');
  ok(looks.count === 3, `three copies made, each shared by the rows wearing it (${looks.count})`);
  ok(meshesOf('place/red0').every((m) => m.castShadow === plainBody.castShadow), 'a copy casts as its source casts');
  sb.buildAll();
  // The lamps' own tier (the rock's stands in another), and which sources its batch took, not merely that it is whole
  // (`buildAll` makes every batch whole whatever it took).
  const tier = h.s.regions.get('0,0')?.tiers.find((t: unknown) => t && t !== 'loading' && (t as { meshes?: THREE.Object3D[] }).meshes?.includes(plainBody) && (t as { batch?: unknown }).batch);
  const redMesh = meshesOf('place/red0').find((m) => m.material === red)!;
  const picMesh = meshesOf('place/pic').find((m) => m.material === pic)!;
  const taken = (m: THREE.InstancedMesh) => !!tier && tier.batch.plain.some((s: { mesh: THREE.InstancedMesh }) => s.mesh === m);
  ok(!!tier && tier.batch.whole && batchable(redMesh) === '' && batchable(picMesh) === '' && taken(redMesh) && taken(picMesh) && taken(plainBody), `the tier's still casters, copies and all, go into its shadow batch: the tinted and the borrowed picture's meshes taken as their source's is (${tier?.batch.plain.length} sources taken)`);
}

// ---- 2. A looked row stood after its tier: meshes of its own, its copy let go with it and kept as a spare. ----
{
  stand(h, 'place/green', 'lamp', 52, 40, [{ of: '*', tint: '#00ff00' }]);
  await h.settle({ x: 44, z: 44 }, 10);
  const rec = h.s.runtime.get(placed(h, 'place/green'));
  const green = rec?.meshes.map((m: THREE.InstancedMesh) => m.material as THREE.MeshStandardMaterial) ?? [];
  ok(!!rec && green.length === 2 && green.every((m: THREE.Material) => looks.isCopy(m)), 'stood after its tier, it is drawn on meshes of its own wearing its copies (`*` reaches both pieces)');
  const before = looks.count;
  const spares = looks.spares;
  for (const m of green) m.addEventListener('dispose', () => disposed.push(m));
  h.stream.unplace('place/green');
  ok(looks.count === before - 2 && looks.spares === spares + 2 && green.every((m: THREE.Material) => !forgotten.includes(m) && !disposed.includes(m)), 'taken away (one `unplace`), its copies, which no other row wears, are held no more and kept for the world as spares');
  // Stood again (a landed write, or its tier come back): the very copies, nothing made.
  const made = looks.made;
  stand(h, 'place/green', 'lamp', 52, 40, [{ of: '*', tint: '#00ff00' }]);
  await h.settle({ x: 44, z: 44 }, 10);
  const again = h.s.runtime.get(placed(h, 'place/green'))?.meshes.map((m: THREE.InstancedMesh) => m.material) ?? [];
  ok(again.length === 2 && again.every((m: THREE.Material, i: number) => m === green[i]) && looks.made === made && looks.spares === spares, 'stood again, it wears the very copies it wore (no copy made, so no program built)');
  h.stream.unplaceMany(['place/green']);
  ok(looks.count === before - 2 && looks.spares === spares + 2, 'and taken away again by many, kept again');
}

// ---- 3. The world going: the streamer lets go of every copy its tiers held, and the looks' own clear forgets and disposes. ----
{
  // A looked row standing on the runtime path as the streamer goes, beside the folded ones.
  stand(h, 'place/blue', 'lamp', 56, 40, [{ of: 'body', tint: '#0000ff' }]);
  await h.settle({ x: 44, z: 44 }, 10);
  const blue = h.s.runtime.get(placed(h, 'place/blue'))?.meshes.find((m: THREE.InstancedMesh) => (m.material as THREE.Material).name === 'body')?.material as THREE.Material | undefined;
  const all = [matOf('place/red0', 'body'), matOf('place/pic', 'body'), matOf('place/like', 'glass'), blue] as THREE.Material[];
  for (const m of all) m.addEventListener('dispose', () => disposed.push(m));
  const held = looks.count;
  const spares = looks.spares;
  h.stream.dispose();
  ok(!!blue && looks.isCopy(blue) && held === 4 && looks.count === 0 && looks.spares === spares + held && !all.some((m) => disposed.includes(m)), `the streamer going lets go of every copy its tiers held, the folded rows' and a runtime row's (${held}), each kept as a spare until the world's own clear`);
  looks.clear();
  ok(all.every((m) => forgotten.includes(m) && disposed.includes(m)) && looks.count === 0 && looks.spares === 0, 'the world going forgets every copy and then disposes it');
  ok(forgotten.indexOf(all[0]) < forgotten.length && texturesDisposed === 0, 'and never disposes a texture (the source\'s or the donor\'s)');
}

// ---- 3b. A looked row whose donor's model is not loaded when its tier splits: the runtime path, which loads it. ----
{
  const fresh = new RowMaterials({ forget: () => {} });
  const x = await makeStreamer(undefined, { defs: [LAMP, SIGN], models: { lamp: lampModel(), sign: signModel() } });
  x.s.looks = fresh;
  // A plain lamp asks the tier for the lamp alone; the borrowed picture's row is filed while the tier loads (after its
  // models were collected, so its donor is not among them), and so is a borrowed material's.
  stand(x, 'place/plain', 'lamp', 40, 40);
  x.stream.update(new THREE.Vector3(44, 0, 44));
  ok(x.s.regions.get('0,0')?.tiers[0] === 'loading', "the tier is loading (its models collected), and the looked rows are filed now");
  stand(x, 'place/during-pic', 'lamp', 44, 40, [{ of: 'body', map: 'tatooine:sign/face' }]);
  stand(x, 'place/during-like', 'lamp', 48, 40, [{ of: 'glass', like: 'tatooine:sign/face' }]);
  await x.settle({ x: 44, z: 44 }, 30);
  const runtimeMat = (key: string, name: string): THREE.MeshStandardMaterial | null => {
    const rec = x.s.runtime.get(x.s.placedByKey.get(key));
    const m = rec?.meshes.find((mesh: THREE.InstancedMesh) => (mesh.material as THREE.Material).name === name);
    return m ? (m.material as THREE.MeshStandardMaterial) : null;
  };
  const dp = x.s.placedByKey.get('place/during-pic');
  const dl = x.s.placedByKey.get('place/during-like');
  ok(!!x.s.foldOf.get(x.s.placedByKey.get('place/plain')) && !x.s.foldOf.get(dp) && !!x.s.runtime.get(dp) && !x.s.foldOf.get(dl) && !!x.s.runtime.get(dl), 'the plain row folds; the rows whose donor was not loaded before the split take the runtime path');
  ok(runtimeMat('place/during-pic', 'body')?.map === faceMat.map && runtimeMat('place/during-like', 'glass')?.map === faceMat.map && fresh.isCopy(runtimeMat('place/during-like', 'glass')!), "and each wears its donor's picture or material: the runtime path loaded the donor before it built");
  x.stream.dispose();
  fresh.clear();
}

// ---- 3c. A borrowed picture stood after its tier, its donor never loaded: the runtime path loads it. ----
{
  const fresh = new RowMaterials({ forget: () => {} });
  const x = await makeStreamer(undefined, { defs: [LAMP, SIGN], models: { lamp: lampModel(), sign: signModel() } });
  x.s.looks = fresh;
  stand(x, 'place/plain', 'lamp', 40, 40);
  await x.settle({ x: 44, z: 44 }, 30);
  ok(!x.s.pack.loaded('sign'), 'the tier built over the plain lamp alone: the sign never loaded');
  stand(x, 'place/late-pic', 'lamp', 44, 40, [{ of: 'body', map: 'tatooine:sign/face' }]);
  await x.settle({ x: 44, z: 44 }, 10);
  const rec = x.s.runtime.get(x.s.placedByKey.get('place/late-pic'));
  const body = rec?.meshes.find((m: THREE.InstancedMesh) => (m.material as THREE.Material).name === 'body')?.material as THREE.MeshStandardMaterial | undefined;
  ok(!!body && body.map === faceMat.map && fresh.isCopy(body) && !fresh.notes.length, "stood after its tier, a borrowed picture's row loads its donor and wears its picture");
  x.stream.dispose();
  fresh.clear();
}

// ---- 4. With no look, a70487c's streamer's own scene over permanent rows. ----
{
  async function oldStreamer(): Promise<(new (...args: any[]) => any) | null> {
    const files = ['src/world/layoutStream.ts', 'src/world/levelGroup.ts'];
    const texts = new Map<string, string>();
    try {
      for (const f of files) texts.set(f, execFileSync('git', ['show', `${PRE_WAVE}:${f}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n'));
    } catch {
      return null;
    }
    const dir = mkdtempSync(join(tmpdir(), 'looksfold-prewave-'));
    const three = import.meta.resolve('three');
    try {
      for (const f of files) {
        const base = f.split('/').pop()!;
        const from = resolve(REPO, f, '..');
        const text = texts.get(f)!.replace(/from 'three'/g, `from '${three}'`).replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => {
          const target = resolve(from, p).replace(/\\/g, '/');
          const own = files.find((x) => resolve(REPO, x).replace(/\\/g, '/') === target);
          return `from '${own ? pathToFileURL(join(dir, own.split('/').pop()!)).href : pathToFileURL(resolve(from, p)).href}'`;
        });
        writeFileSync(join(dir, base), text);
      }
      const mod = await import(pathToFileURL(join(dir, 'layoutStream.ts')).href);
      return mod.LayoutStreamer;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const picture = (x: H): string[] =>
    x.scene.children.map((c) => {
      const m = c as THREE.InstancedMesh;
      const batched = (c as unknown as { isBatchedMesh?: boolean; instanceCount?: number }).isBatchedMesh ? (c as unknown as { instanceCount: number }).instanceCount : -1;
      // Every matrix element exactly (a float32 written out whole, so a difference anywhere in it shows).
      return [c.type, m.isInstancedMesh ? m.count : -1, batched, m.isInstancedMesh ? Array.from(m.instanceMatrix.array as Float32Array, (v) => String(v)).join(',') : '', (m.geometry?.getAttribute('position')?.count ?? -1), (m.material as THREE.Material)?.name, c.visible, m.castShadow, m.receiveShadow, c.layers.mask, c.renderOrder].join('|');
    });
  const run = async (Streamer?: new (...args: any[]) => any) => {
    const x = await makeStreamer(undefined, { defs: [LAMP, SIGN], models: { lamp: lampModel(), sign: signModel() }, ...(Streamer ? { Streamer } : {}) });
    if (!Streamer) x.s.looks = new RowMaterials({ forget: () => {} });
    // The tier's shadow batch too, built over what the streamer drew.
    const batches = new ShadowBatches(x.scene);
    x.stream.shadowBatches = batches;
    for (let i = 0; i < 4; i++) stand(x, `place/l${i}`, 'lamp', 40 + i * 3, 40);
    stand(x, 'place/s0', 'sign', 50, 50);
    await x.settle({ x: 44, z: 44 }, 30);
    // And one after its tier, on the runtime path.
    stand(x, 'place/late', 'lamp', 60, 40);
    await x.settle({ x: 44, z: 44 }, 10);
    batches.buildAll();
    return picture(x);
  };
  const now = await run();
  const hash = (p: string[]) => createHash('sha1').update(p.join('\n')).digest('hex').slice(0, 16);
  // a70487c's streamer's scene over these very rows, hashed: what today's is held to where git cannot hand that streamer
  // over, so the day one never passes on nothing.
  const PRE_WAVE_PICTURE = '822aced50bff028c';
  ok(now.some((s) => Number(s.split('|')[2]) > 0), `the shadow batch among them (${now.filter((s) => Number(s.split('|')[2]) > 0).map((s) => s.split('|').slice(0, 3).join(' ')).join('; ')})`);
  const Old = await oldStreamer();
  if (!Old) ok(hash(now) === PRE_WAVE_PICTURE, `git cannot hand ${PRE_WAVE}'s streamer over: with no look, the scene over permanent rows is the one recorded from it (${hash(now)})`);
  else {
    const then = await run(Old);
    ok(now.length === then.length && now.length > 0 && now.every((s, i) => s === then[i]), `with no look, the scene over permanent rows -- folded and stood after their tier, and the tier's shadow batch -- is ${PRE_WAVE}'s: its meshes, order, counts, every matrix element exactly, materials and flags (${now.length} against ${then.length})`);
    ok(hash(then) === PRE_WAVE_PICTURE, `and that streamer's scene is the one recorded here for a machine where git cannot hand it over (${hash(then)})`);
  }
}

console.log(`\nlooksFold: ${checks} checks passed`);
