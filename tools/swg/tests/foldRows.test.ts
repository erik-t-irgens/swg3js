// The world's permanent rows folded into their region tiers (DESIGN.md §2.8, map-maker wave 3), on the real streamer and
// the real physics (`streamHarness.ts`): rows filed before their tier loads go into its bulk -- one instanced mesh a piece
// a region, a level group for an outdoor levelled model -- where each was drawn on meshes of its own before; a row filed
// while its tier is loading whose model nothing else of the tier uses takes the runtime path, drawn and solid, where the
// bulk would have dropped it; a folded row taken down is hidden in place (a scale-nought matrix at its own place at every
// slot, never a zero matrix, its level copy held at nothing, its collider gone, its building out of the streamer's list,
// the tier's instance count unchanged, the shadow batch's sphere not grown toward the origin) and `showInPlace` puts it
// back to the bit; the same key placed again stands once; rows filed after the tier loaded take the runtime path and
// `settled` waits for their builds; the held regions are exactly the rows' and load when let go; the world editor's live
// edit of a folded row (its copies, its hide, the write, the undo) ends drawn once and solid once; and with no rows, a
// tier's meshes, their order and their counts are 5a4e765's streamer's over the same layout (loaded out of git).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The harness first: it stands a stub in for the particle player before anything loads the streamer.
const { makeStreamer, loadedOf, boxGeo, gatePrepare, THREE } = await import('./streamHarness.ts');
const { ShadowBatches } = await import('../../../src/world/shadowBatches.ts');

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
/** The pass's start (origin/main when the map-maker pass began): what the streamer drew with no permanent row at all. */
const PRE_PASS = '5a4e765';
/**
 * The SHA-1 of what that streamer draws over §8's layout, settled and then swept from one eye (`trace`), worked out from
 * the streamer loaded out of git at `PRE_PASS`: what today's is held to where git cannot hand the old one over.
 */
const PRE_PASS_TRACE = '20908f7ec3043197796a0c4fc005838dfe278ae0';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

/** A tree with two of the client's levels: 2 m across and 10 m tall, its coarse level the same box on a geometry of its own. */
const TREE = { id: 'tree', file: 'tree.glb', bounds: { min: [-1, 0, -1], max: [1, 10, 1] }, triangles: 24 };
function treeModel() {
  const m = loadedOf(TREE, [{ geometry: boxGeo(2, 10, 2, 0), cell: -1 }]) as any;
  m.levels = [
    { near: 0, far: 60, level: 0, primitives: [m.primitives[0]] },
    { near: 60, far: 1e9, level: 1, primitives: [{ geometry: boxGeo(2, 10, 2, 0), material: m.primitives[0].material, cell: -1 }] },
  ];
  return m;
}

type H = Awaited<ReturnType<typeof makeStreamer>>;
const placed = (h: H, key: string) => h.s.placedByKey.get(key);
/** A permanent row stood as the permanent layer stands one: out of `from` (the gallery by default), filed under `key`. */
const stand = (h: H, key: string, model: string, x: number, z: number, opts: { from?: unknown; scale?: [number, number, number] } = {}) =>
  h.stream.standPermanent({ key, model, x, y: 0, z, q: [0, 0, 0, 1], inside: false, solid: true, ...(opts.scale ? { scale: opts.scale } : {}) } as never, (opts.from ?? h.gallery) as never);
/** The loaded tier a placed object is filed in, or null. */
function tierOf(h: H, o: { x: number; z: number; tier: number }): any {
  const region = h.s.regions.get(`${Math.floor(o.x / 256)},${Math.floor(o.z / 256)}`);
  const t = region?.tiers[o.tier];
  return t && t !== 'loading' ? t : null;
}
/** A slot's sixteen numbers. */
function slotOf(mesh: THREE.InstancedMesh, i: number): number[] {
  return Array.from((mesh.instanceMatrix.array as Float32Array).subarray(i * 16, i * 16 + 16));
}

// ---- 1. Rows filed before their tier loads fold into its bulk. ----
const CRATES = 12;
const h = await makeStreamer(undefined, { defs: [TREE], models: { tree: treeModel() } });
const sb = new ShadowBatches(h.scene);
h.stream.shadowBatches = sb;
for (let i = 0; i < CRATES; i++) stand(h, `place/c${i}`, 'crate', 40 + i * 2, 40);
for (let i = 0; i < 3; i++) stand(h, `place/t${i}`, 'tree', 40 + i * 10, 60, { from: h.s.pack });
stand(h, 'place/tbig', 'tree', 80, 60, { from: h.s.pack, scale: [2, 2, 2] });
stand(h, 'place/cbig', 'crate', 40, 70, { scale: [4, 4, 4] });
stand(h, 'place/hall', 'hall', 140, 40);
await h.settle({ x: 60, z: 50 }, 30);
{
  const keys = [...Array.from({ length: CRATES }, (_, i) => `place/c${i}`), 'place/t0', 'place/t1', 'place/t2', 'place/tbig', 'place/cbig', 'place/hall'];
  ok(keys.every((k) => !!h.s.foldOf.get(placed(h, k)) && !h.s.runtime.get(placed(h, k))), `every row filed before its tier loaded is folded into the bulk, none on meshes of its own (${keys.length} rows)`);
  const rep = h.stream.unfoldedReport();
  ok(rep.rows === 0 && rep.meshes === 0 && rep.folded === keys.length, `nothing drawn one by one (${rep.rows} rows, ${rep.meshes} meshes), ${rep.folded} folded`);
  const recs = Array.from({ length: CRATES }, (_, i) => h.s.foldOf.get(placed(h, `place/c${i}`)));
  const mesh0 = recs[0].slots[0].mesh;
  ok(recs.every((r: any) => r.slots.length === 1 && r.slots[0].mesh === mesh0) && mesh0.count === CRATES, `the crates are one instanced mesh of ${mesh0.count}, one slot each`);
  const cbig = h.s.foldOf.get(placed(h, 'place/cbig'));
  // The crate's own radius (both packs' crates are one box, a metre across).
  const crateRadius = 0.5;
  ok(cbig.slots.length === 1 && cbig.slots[0].mesh !== mesh0 && cbig.slots[0].mesh.count === 1, 'the crate stood four times its size is in a mesh of its own size');
  ok(mesh0.userData.casterRadius === crateRadius && cbig.slots[0].mesh.userData.casterRadius === crateRadius * 4, `so the crates at their own size cast at their own radius (${crateRadius} m) and never at the big one's (${cbig.slots[0].mesh.userData.casterRadius} m)`);
  ok(Array.from({ length: CRATES }, (_, i) => h.meshesAt(40 + i * 2, 40)).every((n) => n === 1), 'each drawn once where it stands');
  ok(Array.from({ length: CRATES }, (_, i) => h.rayDown(40 + i * 2, 40)).every((t) => t !== null && Math.abs(t - 1) < 1e-3), 'and each solid a metre high (the collider sweep walks the tier\'s list, folded rows and all)');
  const t0 = h.s.foldOf.get(placed(h, 'place/t0'));
  ok(!!t0.level && t0.level.group.n === 3 && !t0.slots.length, 'an outdoor levelled model is folded into a level group, its copies the trees\'');
  ok(h.meshesAt(40, 60) === 1 && h.meshesAt(50, 60) === 1, 'drawn at its finest level until a sweep');
  // The tree stood twice its size is in a group of its own size (`sizeBuckets`), so the trees at their own size are never
  // cast by its scale: a mesh casts by the rule at its biggest copy's size.
  const big = h.s.foldOf.get(placed(h, 'place/tbig'));
  const radius = treeModel().radius;
  ok(!!big.level && big.level.group !== t0.level.group && big.level.group.n === 1, 'the tree stood twice its size is folded into a level group of its own size');
  ok(t0.level.group.meshes.every((m: THREE.InstancedMesh) => m.userData.casterRadius === radius) && big.level.group.meshes.every((m: THREE.InstancedMesh) => m.userData.casterRadius === radius * 2), `so the trees at their own size cast at their own radius (${radius.toFixed(2)} m) and the big one at twice it`);
  const hallRec = h.s.foldOf.get(placed(h, 'place/hall'));
  ok(!!hallRec.building && h.s.buildings.has(hallRec.building), "the hall's building is the bulk's, filed in the streamer's buildings");
  const tier = tierOf(h, placed(h, 'place/c0'));
  ok(tier.folds instanceof Map && tier.folds.size >= CRATES, 'its tier keeps what the bulk made of each folded row');
  // The shadow batch takes the bulk.
  sb.buildAll();
  ok(!!tier.batch && tier.batch.whole, 'and the tier\'s still casters are batched for the shadow pass, the folded crates among them');
}

// ---- 2. A folded row taken down is hidden in place. ----
{
  const p = placed(h, 'place/c3');
  const r = h.s.foldOf.get(p);
  const { mesh, i } = r.slots[0];
  const tier = tierOf(h, p);
  const before = slotOf(mesh, i);
  const count = mesh.count;
  const inst = tier.instances;
  const loaded = h.s.loadedInstances;
  sb.around();
  sb.restore();
  const batchSphere = tier.batch.mesh.boundingSphere.clone();
  // Taken down the way the game takes a row down: the permanent layer's sync and every editor write go through
  // `unplaceMany` (`World.unplaceMany`), whose own folded branch this is.
  ok(h.stream.unplaceMany(['place/c3']) === 1, 'taken down through `unplaceMany`, as the game takes every row down');
  const after = slotOf(mesh, i);
  ok(after[0] === 0 && after[1] === 0 && after[2] === 0 && after[4] === 0 && after[5] === 0 && after[6] === 0 && after[8] === 0 && after[9] === 0 && after[10] === 0, 'its slot is written at scale nought');
  ok(after[12] === before[12] && after[13] === before[13] && after[14] === before[14] && after[15] === 1, `at its own place, never a zero matrix (${after.slice(12).join(', ')})`);
  ok(mesh.count === count && tier.instances === inst && h.s.loadedInstances === loaded, `nothing counted off: the mesh holds ${mesh.count}, the tier ${tier.instances}, the streamer ${h.s.loadedInstances}`);
  ok(h.meshesAt(46, 40) === 0 && h.meshesAt(44, 40) === 1, 'it draws nothing, and its neighbour is as it was');
  await h.settle({ x: 60, z: 50 }, 4);
  ok(h.rayDown(46, 40) === null && h.rayDown(44, 40) !== null, 'its collider is gone');
  mesh.computeBoundingSphere();
  ok(mesh.boundingSphere!.center.length() > mesh.boundingSphere!.radius, "the mesh's own sphere does not reach the world's origin");
  sb.around();
  sb.restore();
  const s2 = tier.batch.mesh.boundingSphere;
  ok(Math.abs(s2.radius - batchSphere.radius) < 1e-6 && s2.center.distanceTo(batchSphere.center) < 1e-6, `the shadow batch's sphere is not grown toward the origin (radius ${batchSphere.radius.toFixed(3)} to ${s2.radius.toFixed(3)})`);
  ok(r.hidden === 2, 'it is taken down whole');
  // The same key placed again stands once: on a mesh of its own (the tier stands), its folded slot left hidden.
  stand(h, 'place/c3', 'crate', 46, 40);
  await h.settle({ x: 60, z: 50 }, 6);
  const again = placed(h, 'place/c3');
  ok(again !== p && !!h.s.runtime.get(again) && h.meshesAt(46, 40) === 1, 'placed again under its key it stands once, on the runtime path');
  ok(h.rayDown(46, 40) !== null && h.stream.placedState('place/c3')!.colliders === 1, 'and solid once');
  ok(tier.instances === inst + 1, `the tier holds its folded slot and the new row's own (${tier.instances})`);
  ok(h.stream.unfoldedReport().rows === 1, 'and the bar counts one row drawn one by one');
  h.stream.unplace('place/c3');
  await h.settle({ x: 60, z: 50 }, 4);
  ok(h.meshesAt(46, 40) === 0 && h.rayDown(46, 40) === null && !h.hasRecord('place/c3'), 'taken down again, nothing of it is left that no key can reach');
  ok(h.stream.unfoldedReport().rows === 0, 'and nothing is drawn one by one');
  // Its building out of the streamer's list.
  const hall = placed(h, 'place/hall');
  const b = h.s.foldOf.get(hall).building;
  const top = h.rayDown(140, 40);
  h.stream.unplaceMany(['place/hall']);
  await h.settle({ x: 60, z: 50 }, 4);
  ok(top !== null && !h.s.buildings.has(b) && h.rayDown(140, 40) === null, "a folded hall taken down leaves the streamer's buildings, and nothing of it is solid");
  // And the single removal's own folded branch (`unplace`, a building taken up, a key placed again): the same.
  const r9 = h.s.foldOf.get(placed(h, 'place/c9'));
  h.stream.unplace('place/c9');
  await h.settle({ x: 60, z: 50 }, 4);
  ok(r9.hidden === 2 && h.meshesAt(58, 40) === 0 && h.rayDown(58, 40) === null && r9.slots[0].mesh.count === CRATES, 'taken down through `unplace` alone it is hidden in place too, nothing counted off');
}

// ---- 3. Hidden while the editor moves it, and shown again to the bit. ----
{
  const key = 'place/c7';
  const p = placed(h, key);
  const r = h.s.foldOf.get(p);
  const { mesh, i } = r.slots[0];
  const before = slotOf(mesh, i);
  h.stream.setEditorHidden(key, true);
  ok(r.hidden === 1 && h.meshesAt(54, 40) === 0 && h.stream.placedState(key)!.colliders === 1, 'the live hide hides its slot and leaves its collider, as a runtime row\'s');
  h.stream.setEditorHidden(key, false);
  const back = slotOf(mesh, i);
  ok(r.hidden === 0 && back.every((v, k) => Object.is(v, before[k])), 'shown again, its matrix is put back to the bit');
  // A level copy hidden and shown.
  const t = h.s.foldOf.get(placed(h, 'place/t1'));
  const g = t.level.group;
  h.stream.setEditorHidden('place/t1', true);
  ok(g.hiddenCopies === 1 && g.level[t.level.i] === g.levelCount && h.meshesAt(50, 60) === 0, 'a level copy is held at nothing');
  // The group sweeps every frame in the game: from an eye whose distances put the copies at different levels (each copy
  // picked on its own), and from one that settles the whole group at once, the hidden copy stays at nothing.
  g.sweep(-15, 5, 60, 1, 1e9);
  ok(g.level[t.level.i] === g.levelCount && g.level[h.s.foldOf.get(placed(h, 'place/t0')).level.i] === 0 && g.level[h.s.foldOf.get(placed(h, 'place/t2')).level.i] === 1 && h.meshesAt(50, 60) === 0, 'swept copy by copy (the near tree at its finest, the far at its coarse), the hidden one stays at nothing');
  g.sweep(50, 5, 60, 1, 1e9);
  ok(g.level[t.level.i] === g.levelCount && h.meshesAt(50, 60) === 0 && h.meshesAt(40, 60) === 1, 'and swept from beside the group, which settles it whole, still at nothing');
  g.sweep(50, 5, 2000, 1, 1e9);
  ok(g.level[t.level.i] === g.levelCount && h.meshesAt(50, 60) === 0, 'and from far off, settled whole at its coarse level, still at nothing');
  h.stream.setEditorHidden('place/t1', false);
  ok(g.hiddenCopies === 0 && h.meshesAt(50, 60) === 1, 'and shown again');
  // Taken down whole (`unplaceMany`), swept again: never drawn again by any sweep.
  h.stream.unplaceMany(['place/t1']);
  g.sweep(-15, 5, 60, 1, 1e9);
  g.sweep(50, 5, 60, 1, 1e9);
  ok(g.level[t.level.i] === g.levelCount && h.meshesAt(50, 60) === 0 && t.hidden === 2, 'a levelled row taken down whole is held at nothing through every sweep after');
}

// ---- 4. The world editor's live edit of a folded row: picked, moved and undone. ----
{
  const key = 'place/c5';
  const tier = tierOf(h, placed(h, key));
  const inst = tier.instances;
  const copies = h.stream.editorCopies(key);
  ok(copies.length === 1 && copies[0].geometry === h.s.foldOf.get(placed(h, key)).slots[0].mesh.geometry, "the editor's copies of a folded row are made of the bulk's own geometry and material");
  h.stream.setEditorHidden(key, true);
  ok(h.meshesAt(50, 40) === 1, 'while it moves it is drawn once: the copy alone');
  // The write lands (`PermanentLayer.landChanges`, through `unplaceMany`): the row taken down and stood again where it went,
  // the copies let go.
  h.stream.unplaceMany([key]);
  stand(h, key, 'crate', 50, 45);
  h.stream.dropEditorCopies(copies);
  h.stream.setEditorHidden(key, false);
  await h.settle({ x: 60, z: 50 }, 6);
  ok(h.meshesAt(50, 40) === 0 && h.meshesAt(50, 45) === 1 && h.rayDown(50, 40) === null && h.rayDown(50, 45) !== null, 'moved: drawn once and solid once where it went, nothing where it was');
  // Undone: written back where it was.
  h.stream.unplaceMany([key]);
  stand(h, key, 'crate', 50, 40);
  await h.settle({ x: 60, z: 50 }, 6);
  ok(h.meshesAt(50, 40) === 1 && h.meshesAt(50, 45) === 0, 'undone: drawn once, at the right place');
  ok(h.stream.placedState(key)!.colliders === 1 && h.rayDown(50, 40) !== null && Math.abs(h.rayDown(50, 40)! - 1) < 1e-3, 'solid once, a metre high');
  ok(tier.instances === inst + 1, `the tier's count keeps the folded slot (hidden, never counted off) and the row's own on the runtime path until the next fold (${inst} to ${tier.instances})`);
  // No copies of a row hidden whole while still filed (the fifth wave's world objects taken away): it draws nothing to copy.
  const down = placed(h, 'place/c6');
  const its = h.stream.editorCopies('place/c6');
  ok(its.length === 1, 'a folded row standing has its copy');
  h.stream.dropEditorCopies(its);
  h.stream.hideInPlace(down, true);
  ok(h.s.foldOf.get(down).hidden === 2 && h.stream.editorCopies('place/c6').length === 0, 'and none once it is hidden whole');
  h.stream.showInPlace(down);
  ok(h.s.foldOf.get(down).hidden === 0 && h.meshesAt(52, 40) === 1, 'shown again, drawn once where it stands');
}

// ---- 5. Rows filed after the tier loaded take the runtime path; `settled` waits for their builds. ----
{
  const g = await makeStreamer();
  const gate = gatePrepare(g.stream);
  stand(g, 'place/a', 'crate', 40, 40);
  await g.settle({ x: 40, z: 40 }, 20);
  ok(!!g.s.foldOf.get(placed(g, 'place/a')), 'a row filed before its tier loaded is folded');
  ok(g.s.foldOf.get(placed(g, 'place/a')).tier.ready === true, "and its tier's bulk is ready once its programs exist");
  gate.arm();
  stand(g, 'place/b', 'crate', 44, 40);
  for (let i = 0; i < 5 && !gate.held; i++) await new Promise((r) => setTimeout(r, 0));
  ok(gate.held && !g.s.foldOf.get(placed(g, 'place/b')) && !!g.s.runtime.get(placed(g, 'place/b')), 'a row filed after its tier loaded takes the runtime path');
  ok(!g.stream.settled(40, 40), 'and `settled` is false while its build is outstanding');
  gate.open();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  ok(g.stream.settled(40, 40) && g.meshesAt(44, 40) === 1, 'and true once it is built');
  ok(g.stream.unfoldedReport().rows === 1 && g.stream.unfoldedReport().meshes === 1 && g.stream.unfoldedCount === 1, 'the bar counts it drawn one by one');
  ok(g.stream.refile(g.stream.filing, true), 'Fold now files every tier again under the rule in force');
  await g.settle({ x: 40, z: 40 }, 20);
  ok(!!g.s.foldOf.get(placed(g, 'place/b')) && !g.s.runtime.get(placed(g, 'place/b')) && g.stream.unfoldedCount === 0, 'and after it the row is folded too');
  ok(g.meshesAt(40, 40) === 1 && g.meshesAt(44, 40) === 1 && g.rayDown(44, 40) !== null, 'each drawn and solid once');
  ok(!g.stream.refile(g.stream.filing), 'and the plain call under the rule in force does nothing, as before');
}

// ---- 6. A row filed while its tier is loading. ----
{
  const g = await makeStreamer();
  stand(g, 'place/first', 'crate', 40, 40);
  g.stream.update(new THREE.Vector3(40, 0, 40));
  const region = g.s.regions.get('0,0');
  const p0 = placed(g, 'place/first');
  ok(region.tiers[p0.tier] === 'loading', 'the tier is loading');
  // Another crate (its model is the first row's, already loading) and a stool out of another world's pack, which nothing of
  // this tier uses: the bulk would draw and collide nothing of it.
  stand(g, 'place/same', 'crate', 42, 40);
  const STOOL = { id: 'stool', file: 'stool.glb', bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, triangles: 12 };
  const stoolModel = loadedOf(STOOL, [{ geometry: boxGeo(1, 1, 1, 0), cell: -1 }]);
  const ready = new Map<string, unknown>();
  const naboo = {
    manifest: { planet: 'naboo', categories: { layout: [STOOL] } },
    root: '/assets-private/naboo/',
    objectEffects: null,
    doors: null,
    find: (id: string) => (id === 'stool' ? STOOL : undefined),
    isFlora: () => false,
    loaded: (id: string) => ready.get(id) ?? null,
    model: async () => {
      ready.set('stool', stoolModel);
      return stoolModel;
    },
  };
  g.stream.standPermanent({ key: 'place/other', model: 'stool', x: 44, y: 0, z: 40, q: [0, 0, 0, 1], inside: false, solid: true, from: 'naboo' } as never, naboo as never);
  await g.settle({ x: 40, z: 40 }, 20);
  ok(!!g.s.foldOf.get(placed(g, 'place/same')), 'a row filed while its tier loads, of a model the tier is loading, is folded');
  ok(!g.s.foldOf.get(placed(g, 'place/other')) && !!g.s.runtime.get(placed(g, 'place/other')), 'one whose model nothing of the tier uses takes the runtime path');
  ok(g.meshesAt(44, 40) === 1 && g.rayDown(44, 40) !== null, 'and is drawn and solid, where the bulk would have dropped it');
}

// ---- 7. The held regions. ----
{
  const g = await makeStreamer([
    { template: 'object/rock', model: 'rock', x: -100, y: 0, z: 100, q: [1, 0, 0, 0], radius: 40 },
    { template: 'object/crate', model: 'crate', x: -600, y: 0, z: 100, q: [1, 0, 0, 0], radius: 1 },
  ]);
  ok(g.stream.holdRegions([{ x: 40, z: 40 }, { x: 42, z: 41 }, { x: Number.NaN, z: 0 }]) === 1, 'the regions held are exactly the rows\' (two rows in one region, a place that is no place left out)');
  stand(g, 'place/h1', 'crate', 40, 40);
  stand(g, 'place/h2', 'crate', 42, 41);
  await g.settle({ x: 40, z: 40 }, 10);
  ok(!g.stream.placedState('place/h1')!.tierLoaded && !g.stream.settled(40, 40), 'a held region loads nothing, and the world is not settled there');
  await g.settle({ x: 600, z: 100 }, 10);
  ok(g.stream.settled(600, 100) && g.meshesAt(600, 100) === 1, 'a region holding no rows loads as ever');
  g.stream.releaseRegions();
  ok(g.stream.heldRegions === 0, 'let go');
  await g.settle({ x: 40, z: 40 }, 20);
  ok(g.stream.placedState('place/h1')!.tierLoaded && !!g.s.foldOf.get(placed(g, 'place/h1')) && !!g.s.foldOf.get(placed(g, 'place/h2')), 'and once let go it loads with its rows folded');
}

// ---- 7b. A tier still loading its models when Fold now files again, and when its region is held. ----
{
  /** A streamer whose world's models wait at a gate until opened: a tier caught loading its models. */
  async function gated(objects = [{ template: 'object/crate', model: 'crate', x: -40, y: 0, z: 40, q: [1, 0, 0, 0], radius: 1 }]) {
    const g = await makeStreamer(objects);
    const pack = g.s.pack;
    const real = pack.model;
    const waiting: (() => void)[] = [];
    let shut = true;
    pack.model = (id: string) => (shut ? new Promise((r) => waiting.push(() => r(real(id)))) : real(id));
    return {
      g,
      open() {
        shut = false;
        for (const w of waiting.splice(0)) w();
      },
      get waiting() {
        return waiting.length;
      },
    };
  }
  const at = new THREE.Vector3(40, 0, 40);
  // Fold now (`refile` with `force`) while the tier waits on its model, and the update straight after (`App.editorFold`),
  // which begins a new build of the new list: the build let go stands nothing when its model comes in.
  {
    const { g, open } = await gated();
    g.stream.update(at);
    const region = g.s.regions.get('0,0');
    const crateTier = region.tiers.findIndex((t: unknown) => t === 'loading');
    ok(crateTier >= 0, 'a tier is loading its model');
    ok(g.stream.refile(g.stream.filing, true), 'Fold now files every tier again while it loads');
    g.stream.update(at);
    ok(region.tiers[crateTier] === 'loading', 'and the update straight after begins a build of the new list');
    open();
    await g.settle({ x: 40, z: 40 }, 20);
    ok(g.tiersShareLists() > 0, `the tier that stands is the region's own list, not the old one the let-go build held (${g.tiersShareLists()})`);
    ok(g.meshesAt(40, 40) === 1, 'the snapshot crate is drawn once');
    await g.put('place/after', 'crate', 44, 40, { solid: true });
    await g.settle({ x: 40, z: 40 }, 20);
    ok(g.meshesAt(44, 40) === 1 && g.rayDown(44, 40) !== null, 'and a thing put down afterwards in that tier is drawn and solid');
    // Taken out with the tier: nothing of it is left that no key can reach.
    g.s.unloadTier(region, crateTier);
    ok(!g.hasRecord('place/after') && g.meshesAt(44, 40) === 0, 'and goes with the tier when it unloads, its record with it');
  }
  // A region held while its tier waits on its model (an arrival's hold coming after the frame loop began a build): the
  // build is let go, nothing loads while it is held, and once let go the tier loads with the rows filed meanwhile folded.
  {
    const { g, open } = await gated();
    g.stream.update(at);
    const region = g.s.regions.get('0,0');
    const crateTier = region.tiers.findIndex((t: unknown) => t === 'loading');
    ok(g.stream.holdRegions([{ x: 40, z: 40 }]) === 1 && region.tiers[crateTier] === null, 'a region held while its tier loads lets the build go');
    stand(g, 'place/held', 'crate', 42, 40);
    open();
    await g.settle({ x: 40, z: 40 }, 10);
    ok(region.tiers[crateTier] === null && g.meshesAt(40, 40) === 0, 'and the let-go build stands nothing once its model is in, the region still held');
    g.stream.releaseRegions();
    await g.settle({ x: 40, z: 40 }, 20);
    ok(g.tiersShareLists() > 0 && !!g.s.foldOf.get(placed(g, 'place/held')) && g.meshesAt(42, 40) === 1 && g.meshesAt(40, 40) === 1, 'let go, it loads once, with the row filed meanwhile folded into it');
  }
  // A region held whose tier is already built: taken down, and built again with the row once let go.
  {
    const g = await makeStreamer([{ template: 'object/crate', model: 'crate', x: -40, y: 0, z: 40, q: [1, 0, 0, 0], radius: 1 }]);
    await g.settle({ x: 40, z: 40 }, 20);
    ok(g.meshesAt(40, 40) === 1, 'a tier built before the hold');
    g.stream.holdRegions([{ x: 40, z: 40 }]);
    ok(g.meshesAt(40, 40) === 0 && g.s.loadedInstances === 0, 'held, it is taken down');
    stand(g, 'place/later', 'crate', 42, 40);
    g.stream.releaseRegions();
    await g.settle({ x: 40, z: 40 }, 20);
    ok(!!g.s.foldOf.get(placed(g, 'place/later')) && g.meshesAt(40, 40) === 1 && g.meshesAt(42, 40) === 1, 'and let go, built again with the row filed meanwhile folded');
  }
}

// ---- 7c. No copies of a folded row before its tier's programs exist. ----
{
  // No snapshot objects, so the one tier the gate holds is the row's.
  const g = await makeStreamer([]);
  const gate = gatePrepare(g.stream);
  gate.arm();
  stand(g, 'place/early', 'crate', 40, 40);
  for (let i = 0; i < 20 && !gate.held; i++) await g.settle({ x: 40, z: 40 }, 1);
  ok(gate.held && !!g.s.foldOf.get(placed(g, 'place/early')) && g.s.foldOf.get(placed(g, 'place/early')).tier.ready === false, "a folded row's tier held at its prepare is not ready");
  ok(g.stream.editorCopies('place/early').length === 0, "and the editor gets no copies of the row (they would draw the bulk's materials before their programs exist)");
  gate.open();
  await g.settle({ x: 40, z: 40 }, 4);
  const c = g.stream.editorCopies('place/early');
  ok(c.length === 1, 'once they exist, it does');
  g.stream.dropEditorCopies(c);
}

// ---- 7d. A folded basin's water taken down with it. ----
{
  const BASIN = { id: 'basin', file: 'basin.glb', bounds: { min: [-2, 0, -2], max: [2, 1, 2] }, triangles: 12 };
  const water = new THREE.MeshStandardMaterial();
  water.name = 'shader/wter_aqua.sht';
  const basin = loadedOf(BASIN, [{ geometry: boxGeo(4, 0.2, 4, 0.8), cell: -1, material: water }]);
  const g = await makeStreamer(undefined, { defs: [BASIN], models: { basin } });
  let made = 0;
  let gone = 0;
  g.stream.waterSurface = (geometry: THREE.BufferGeometry) => {
    made++;
    return { mesh: new THREE.Mesh(geometry), remove: () => void gone++ };
  };
  stand(g, 'place/basin', 'basin', 40, 40, { from: g.s.pack });
  await g.settle({ x: 40, z: 40 }, 20);
  const rec = g.s.foldOf.get(placed(g, 'place/basin'));
  ok(!!rec && rec.waters.length === 1 && made === 1 && rec.tier.waters.includes(rec.waters[0].h), "a folded basin's water is the water system's, kept in its tier's list and its record");
  const h0 = rec.waters[0].h;
  g.stream.unplaceMany(['place/basin']);
  ok(gone === 1 && !rec.tier.waters.includes(h0) && rec.waters[0].h === null, 'taken down whole, its water body is taken away once and out of its tier\'s list');
}

// ---- 8. With no rows, a tier is 5a4e765's. ----
{
  const objects = [
    { template: 'object/rock', model: 'rock', x: -100, y: 0, z: 100, q: [1, 0, 0, 0], radius: 40 },
    { template: 'object/crate', model: 'crate', x: -40, y: 0, z: 40, q: [1, 0, 0, 0], radius: 1 },
    { template: 'object/crate', model: 'crate', x: -44, y: 0, z: 40, q: [0, 0.7071067811865476, 0, 0.7071067811865476], radius: 1 },
    { template: 'object/tree', model: 'tree', x: -60, y: 0, z: 60, q: [1, 0, 0, 0], radius: 1 },
    { template: 'object/tree', model: 'tree', x: -70, y: 0, z: 60, q: [1, 0, 0, 0], radius: 1 },
  ];
  /** The old streamer and its level group out of git, every other relative import pointed at the current file. */
  async function oldStreamer(): Promise<(new (...args: any[]) => any) | null> {
    const files = ['src/world/layoutStream.ts', 'src/world/levelGroup.ts'];
    const texts = new Map<string, string>();
    try {
      for (const f of files) texts.set(f, execFileSync('git', ['show', `${PRE_PASS}:${f}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n'));
    } catch {
      return null;
    }
    const dir = mkdtempSync(join(tmpdir(), 'foldrows-prepass-'));
    // The very three this test runs on (a copy outside the repository cannot find the package by name).
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
      return [c.type, m.isInstancedMesh ? m.count : -1, m.isInstancedMesh ? Array.from(m.instanceMatrix.array as Float32Array, (v) => v.toFixed(5)).join(',') : '', (m.geometry?.getAttribute('position')?.count ?? -1), c.visible, m.castShadow, m.receiveShadow, c.layers.mask, c.renderOrder, c.name].join('|');
    });
  const tiers = (x: H) => {
    const out: string[] = [];
    for (const [k, region] of x.s.regions) for (let t = 0; t < region.tiers.length; t++) {
      const tier = region.tiers[t];
      if (!tier || tier === 'loading') continue;
      out.push(`${k}:${t}:${tier.meshes.length}:${tier.instances}:${tier.bulk}:${tier.levels.length}:${tier.buildings.length}`);
    }
    return out.sort().join(' ');
  };
  /**
   * Everything a streamer draws over the layout, settled, and again after its level groups are swept from one fixed eye (a
   * sweep is every frame's in the game, and puts the trees at different levels from there): its scene, its tiers and its
   * counts, as text, so the same streamer gives the same text and another any other.
   */
  const trace = async (x: H): Promise<{ text: string; scene: string[]; tiers: string; counts: string }> => {
    await x.settle({ x: 60, z: 60 }, 30);
    const at = { scene: picture(x), tiers: tiers(x), counts: `${x.s.loadedInstances}:${x.s.loadedModels}` };
    x.stream.sweepLevels(new THREE.Vector3(-5, 5, 60), 1, 1, 1e9);
    const swept = picture(x);
    return { ...at, text: [...at.scene, at.tiers, at.counts, '-- swept --', ...swept].join('\n') };
  };
  const sha = (s: string) => createHash('sha1').update(s).digest('hex');
  const now = await trace(await makeStreamer(objects, { defs: [TREE], models: { tree: treeModel() } }));
  const Old = await oldStreamer();
  if (!Old) {
    // Where git cannot hand the old streamer over, today's is held to the hash of the old one's own trace, written in here.
    ok(sha(now.text) === PRE_PASS_TRACE, `with no rows, the streamer's scene, tiers and counts, settled and swept, hash to ${PRE_PASS}'s own (written in; git could not hand its streamer over): ${sha(now.text)}`);
  } else {
    const then = await trace(await makeStreamer(objects, { defs: [TREE], models: { tree: treeModel() }, Streamer: Old }));
    const a = now.scene;
    const b = then.scene;
    ok(a.length === b.length && a.length > 0 && a.every((s, i) => s === b[i]), `with no rows, the scene's meshes, their order, their counts and their matrices are ${PRE_PASS}'s (${a.length} against ${b.length})`);
    ok(now.tiers === then.tiers, `and every tier's meshes, instances, bulk, levels and buildings (${now.tiers})`);
    ok(now.counts === then.counts, `and the streamer's counts (${now.counts})`);
    ok(now.text === then.text, "and so is the scene after its level groups are swept from one eye, copy by copy");
    ok(sha(then.text) === PRE_PASS_TRACE, `and the hash written in here is ${PRE_PASS}'s own trace (${sha(then.text)}), what a checkout with no git is held to`);
  }
}

console.log(`\n${checks} checks passed`);
