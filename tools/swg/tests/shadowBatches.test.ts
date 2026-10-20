// The shadow batches (the performance pass's sixth wave, src/world/shadowBatches.ts) through the real streamer
// (`streamHarness.ts`) over a pack made up on the spot: a plain model placed many times, and a levelled model whose two
// levels have different piece counts, one piece of each level cut out and one double-sided. After the build, a repack
// that moves copies between levels, the page's smallest caster raised, a level's own shadow rule turning its pieces off,
// a source hidden, a source's instance store rewritten and a tier unloaded, the batch's visible instances are exactly the
// (copy, piece) pairs its taken sources would draw into the shadow maps, by geometry and matrix, and what it leaves out
// (the cut-out, the double-sided) casts as it always did; three's own `BatchedMesh.onBeforeRender` lists exactly the
// visible instances whose spheres meet a stand-in shadow camera's frustum; and the swap puts every source's `castShadow`
// back after a pass, one that throws included, inside the pass a taken source casts nothing and its batch does, with
// `batches` false nothing is swapped and no batch casts, and a batch half made leaves its sources casting. After every
// pass every visible instance lies inside its batch's own sphere (three culls the whole batch by it), a copy moved far
// off included; the repack moves copies between two levels that both keep copies; a source turned two-sided in play
// casts on its own; a batch the portal renderer quarantined is never shown again and swaps nothing; and on a second
// streamer, placements made in play (before their tier loads and after) are no batch's source, each reason `batchable`
// leaves a mesh out is its own case, and furniture and a level group's pieces are never handed over as plain sources.
//
// Synthetic: models made up for this test, nothing read from the game's files.
import assert from 'node:assert/strict';
import { CRATE, ROCK, THREE, boxGeo, loadedOf, makeStreamer, type SnapshotObject } from './streamHarness.ts';
import { SHADOW_BATCH_HATCH, ShadowBatches, batchable, type TierBatch } from '../../../src/world/shadowBatches.ts';
import { SHADOW_PASS_TUNE } from '../../../src/world/shadowCadence.ts';
import { SHADOW_CASTER_TUNE } from '../../../src/world/shadowCasters.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

ok(SHADOW_BATCH_HATCH.on, 'node keeps no storage, so the hatch is on');

// The models: a 6 m block (plain), and a tower with two levels -- the finest three pieces (a body, a cut-out grille, a
// double-sided awning), the lowest two (a body and a cut-out grille).
const BLOCK = { id: 'block', file: 'block.glb', bounds: { min: [-3, 0, -3], max: [3, 6, 3] }, triangles: 12 };
const TOWER = { id: 'tower', file: 'tower.glb', bounds: { min: [-4, 0, -4], max: [4, 20, 4] }, triangles: 36 };
const plainMat = new THREE.MeshStandardMaterial();
const cutMat = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
const doubleMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
const towerPrims = [
  { geometry: boxGeo(8, 20, 8, 0), cell: -1, material: plainMat },
  { geometry: boxGeo(6, 2, 6, 20), cell: -1, material: cutMat },
  { geometry: boxGeo(8, 0.2, 8, 12), cell: -1, material: doubleMat },
];
const towerLow = [
  { geometry: boxGeo(8, 18, 8, 0), cell: -1, material: plainMat },
  { geometry: boxGeo(5, 2, 5, 18), cell: -1, material: cutMat },
];
const tower = loadedOf(TOWER, towerPrims);
(tower as { levels: unknown }).levels = [
  { near: 0, far: 60, level: 0, primitives: tower.primitives },
  { near: 60, far: 1e9, level: 1, primitives: towerLow.map((p) => ({ geometry: p.geometry, material: p.material, cell: p.cell })) },
];
const block = loadedOf(BLOCK, [{ geometry: boxGeo(6, 6, 6, 0), cell: -1, material: plainMat }]);

const objects: SnapshotObject[] = [];
const q = [1, 0, 0, 0];
for (let i = 0; i < 6; i++) objects.push({ template: `object/block${i}`, model: 'block', x: -(20 + i * 15), y: 0, z: 30, q, radius: 5 });
for (let i = 0; i < 5; i++) objects.push({ template: `object/tower${i}`, model: 'tower', x: -(20 + i * 30), y: 0, z: 80, q: [Math.cos(i * 0.3), 0, Math.sin(i * 0.3), 0], radius: 6 });
const h = await makeStreamer(objects, { defs: [BLOCK, TOWER], models: { block, tower } });
const sb = new ShadowBatches(h.scene);
h.stream.shadowBatches = sb;
await h.settle({ x: 60, z: 60 }, 30);
ok(sb.tiers.length > 0, `the shown tiers were handed to the batches (${sb.tiers.length})`);
ok(sb.tiers.every((b) => !b.whole), 'a batch half made is not whole');
// A batch half made leaves its sources casting.
{
  sb.around();
  let swapped = 0;
  h.scene.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh && !(o as THREE.InstancedMesh).castShadow && o.visible) swapped++;
  });
  sb.restore();
  ok(swapped === 0, 'a pass before the batch is whole swaps nothing: its sources cast as they always did');
}
sb.buildAll();
ok(sb.tiers.every((b) => b.whole && b.mesh !== null && b.mesh.parent === h.scene), 'built whole, each batch stands in the scene');
ok(sb.tiers.every((b) => b.mesh!.layers.mask === 1 << 28 && b.mesh!.material === sb.tiers[0].mesh!.material), 'on the shadow batches\' own layer, with the session\'s one material');

/** The batches the helpers below read: this test's first harness's, then the second's. */
let cur: ShadowBatches = sb;
const all = (): TierBatch[] => cur.tiers;
const mkey = (geo: THREE.BufferGeometry, m: THREE.Matrix4): string => `${geo.uuid}|${m.elements.map((v) => v.toFixed(4)).join(',')}`;
const wants = (m: THREE.Mesh): boolean => m.castShadow && m.visible && (m.material as THREE.Material).visible;
/** What the taken sources would draw into the shadow maps now, as the rules left them. */
function sourceDraws(): string[] {
  const out: string[] = [];
  const m = new THREE.Matrix4();
  for (const b of all()) {
    for (const s of b.plain) {
      if (!wants(s.mesh)) continue;
      for (let i = 0; i < s.mesh.count; i++) out.push(mkey(s.mesh.geometry, s.mesh.getMatrixAt(i, m)));
    }
    for (const s of b.levels) {
      for (let j = 0; j < s.meshes.length; j++) {
        const piece = s.meshes[j];
        if (!piece || s.geo[j] < 0 || !wants(piece)) continue;
        for (let i = 0; i < piece.count; i++) out.push(mkey(piece.geometry, piece.getMatrixAt(i, m)));
      }
    }
  }
  return out.sort();
}
/** What the batches draw: each visible instance's source geometry at its matrix. */
function batchDraws(): string[] {
  const out: string[] = [];
  const m = new THREE.Matrix4();
  for (const b of all()) {
    const back = new Map<number, THREE.BufferGeometry>();
    for (const [g, id] of b.geoIds) back.set(id, g);
    const info = (b.mesh as unknown as { _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[] })._instanceInfo;
    for (let i = 0; i < info.length; i++) {
      if (!info[i].active || !info[i].visible) continue;
      out.push(mkey(back.get(info[i].geometryIndex)!, b.mesh!.getMatrixAt(i, m)));
    }
  }
  return out.sort();
}
/**
 * Whether every batch's whole-object sphere holds every visible instance's own sphere at its geometry and matrix now:
 * three's shadow pass culls the whole batch against each cascade by that sphere before it looks at any instance
 * (`WebGLShadowMap`'s `_frustum.intersectsObject`), so an instance outside it casts nothing while its source casts
 * nothing either. Answers the worst overhang in metres.
 */
function sphereOverhang(): number {
  let worst = 0;
  const m = new THREE.Matrix4();
  const sp = new THREE.Sphere();
  for (const b of all()) {
    const mesh = b.mesh!;
    const whole = mesh.boundingSphere!;
    const info = (mesh as unknown as { _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[] })._instanceInfo;
    for (let i = 0; i < info.length; i++) {
      if (!info[i].active || !info[i].visible) continue;
      mesh.getBoundingSphereAt(info[i].geometryIndex, sp)!.applyMatrix4(mesh.getMatrixAt(i, m));
      worst = Math.max(worst, sp.center.distanceTo(whole.center) + sp.radius - whole.radius);
    }
  }
  return worst;
}
/** A pass: the sources' wants read, the batches follow and swap, then the swap put back. */
function pass(label: string): void {
  const want = sourceDraws();
  cur.around();
  const got = batchDraws();
  const over = sphereOverhang();
  // Inside the pass a taken source that wants to cast casts nothing; one left out (cut, double-sided) still does.
  let leaked = 0;
  let leftCast = 0;
  for (const b of all()) {
    for (const s of b.plain) if (s.mesh.castShadow && s.want === 1) leaked++;
    for (const s of b.levels) {
      for (let j = 0; j < s.meshes.length; j++) {
        const p = s.meshes[j];
        if (!p) continue;
        // A piece three would draw: casting and shown (a level holding no copy is hidden and draws nothing).
        if (s.geo[j] >= 0 && p.castShadow && p.visible) leaked++;
        if (s.geo[j] < 0 && p.castShadow && p.visible) leftCast++;
      }
    }
  }
  cur.restore();
  ok(want.length === got.length && want.every((k, i) => k === got[i]), `${label}: the batch's visible instances are exactly what its sources would draw (${got.length} of ${want.length})`);
  ok(leaked === 0, `${label}: inside the pass no taken source casts (${leaked})`);
  ok(over <= 1e-6, `${label}: every visible instance lies inside its batch's own sphere, which three culls the whole batch by (worst overhang ${over.toExponential(1)} m)`);
  void leftCast;
}

pass('after the build');
{
  // What it leaves out casts as it always did: the cut-out and the double-sided pieces are no batch's.
  const reasons: Record<string, number> = {};
  for (const b of all()) for (const [k, v] of Object.entries(b.leftOut)) reasons[k] = (reasons[k] ?? 0) + v;
  ok(reasons.cut > 0 && reasons.side > 0, `the cut-out and the double-sided pieces are left out by their reasons (cut ${reasons.cut}, side ${reasons.side})`);
  let castsLeft = 0;
  sb.around();
  for (const b of all()) for (const s of b.levels) for (let j = 0; j < s.meshes.length; j++) if (s.meshes[j] && s.geo[j] < 0 && s.meshes[j]!.castShadow) castsLeft++;
  sb.restore();
  ok(castsLeft > 0, `and inside the pass they cast themselves (${castsLeft} meshes)`);
}
// A repack that moves copies between levels: the eye far away puts every tower at its lowest level; then the eye along
// the towers' row (game x 20 to 140 at z 80) brings the nearest back to their finest with both levels keeping copies, and
// a step along the row moves one more copy across, so the batch must follow each copy's own level by the group's repack
// count (an empty level flipping its pieces' casting is not what tells it).
{
  const s = h.s;
  const levelsNow = (): string => all().flatMap((b) => b.levels.map((l) => Array.from(l.group.level as ArrayLike<number>).join(''))).join(' ');
  s.sweepLevels(new THREE.Vector3(-5000, 0, 5000), 1, 1, Number.POSITIVE_INFINITY);
  pass(`every tower at its lowest level (${levelsNow()})`);
  s.sweepLevels(new THREE.Vector3(0, 0, 80), 1, 1, Number.POSITIVE_INFINITY);
  const mixedA = levelsNow();
  ok(/0/.test(mixedA) && /1/.test(mixedA), `the eye at the row's end: the nearest towers at their finest and the rest at their lowest, both levels keeping copies (${mixedA})`);
  pass(`the nearest towers back at their finest (${mixedA})`);
  s.sweepLevels(new THREE.Vector3(50, 0, 80), 1, 1, Number.POSITIVE_INFINITY);
  const mixedB = levelsNow();
  ok(mixedB !== mixedA && /0/.test(mixedB) && /1/.test(mixedB), `a step along the row moves one more copy across, both levels still keeping copies (${mixedA} to ${mixedB})`);
  pass(`one more tower at its finest (${mixedB})`);
}
// The page's smallest caster raised past the block's size, then put back.
{
  const was = SHADOW_CASTER_TUNE.placedMinRadius;
  SHADOW_CASTER_TUNE.placedMinRadius = 5;
  h.stream.applyCasters();
  pass('the smallest caster raised past the block');
  SHADOW_CASTER_TUNE.placedMinRadius = was;
  h.stream.applyCasters();
  pass('and put back');
}
// A level's own shadow rule turning a level's pieces off.
{
  for (const b of all()) for (const s of b.levels) s.group.setBase((_m, level) => level === 0);
  pass("a level's own rule turning its lowest pieces off");
  for (const b of all()) for (const s of b.levels) s.group.setBase(() => true);
}
// A source hidden; a source's instance store rewritten.
{
  const src = all().flatMap((b) => b.plain)[0].mesh;
  src.visible = false;
  pass('a source hidden');
  src.visible = true;
  const m = new THREE.Matrix4();
  src.getMatrixAt(0, m);
  m.elements[13] += 3;
  src.setMatrixAt(0, m);
  src.instanceMatrix.needsUpdate = true;
  pass("a source's instance store rewritten");
  // A copy moved far past the batch's sphere: the sphere grows to hold it, and a shadow camera over the copy alone
  // finds the whole batch by three's own test (`Frustum.intersectsObject`, the shadow pass's), so the copy casts.
  src.getMatrixAt(1, m);
  const far = new THREE.Vector3(600, 0, -600);
  m.setPosition(far);
  src.setMatrixAt(1, m);
  src.instanceMatrix.needsUpdate = true;
  pass("a source's copy moved 800 m off");
  const owner = all().find((b) => b.plain.some((p) => p.mesh === src))!;
  const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 400);
  cam.position.set(far.x, 150, far.z);
  cam.lookAt(far.x, 0, far.z);
  cam.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  owner.mesh!.updateMatrixWorld(true);
  ok(frustum.intersectsObject(owner.mesh!), 'and a shadow camera over the moved copy alone finds its batch by three\'s own whole-object test');
}
// Three's own culling of the batch's instances against a shadow camera, as its shadow pass hands it over.
{
  const b = all()[0];
  const mesh = b.mesh!;
  sb.around();
  // Over the row of blocks (game x 20 to 95 along z 30: the snapshot's x is mirrored) and not the towers (z 80).
  const cam = new THREE.OrthographicCamera(-25, 25, 25, -25, 1, 400);
  cam.position.set(40, 150, 30);
  cam.lookAt(40, 0, 30);
  cam.updateMatrixWorld();
  const depth = new THREE.MeshDepthMaterial();
  mesh.onBeforeShadow(null as never, mesh, null as never, cam, mesh.geometry, depth, null as never);
  sb.restore();
  const listed = new Set<number>();
  const self = mesh as unknown as { _multiDrawCount: number; _indirectTexture: { image: { data: Uint32Array } }; _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[] };
  for (let i = 0; i < self._multiDrawCount; i++) listed.add(self._indirectTexture.image.data[i]);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const want = new Set<number>();
  const m = new THREE.Matrix4();
  const sp = new THREE.Sphere();
  for (let i = 0; i < self._instanceInfo.length; i++) {
    const inf = self._instanceInfo[i];
    if (!inf.active || !inf.visible) continue;
    mesh.getBoundingSphereAt(inf.geometryIndex, sp)!.applyMatrix4(mesh.getMatrixAt(i, m));
    if (frustum.intersectsSphere(sp)) want.add(i);
  }
  ok(want.size > 0 && want.size < self._instanceInfo.length && listed.size === want.size && [...want].every((i) => listed.has(i)), `three's own onBeforeShadow lists exactly the visible instances whose spheres meet the shadow camera (${listed.size} of ${self._instanceInfo.length})`);
}
// The swap, whatever the pass threw; with `batches` off nothing swapped and no batch casts.
{
  const before = new Map<THREE.Object3D, boolean>();
  h.scene.traverse((o) => before.set(o, (o as THREE.Mesh).castShadow));
  try {
    sb.around();
    throw new Error('a pass that throws');
  } catch {
    // The portal renderer's `finally`.
  } finally {
    sb.restore();
  }
  let changed = 0;
  h.scene.traverse((o) => {
    if (before.get(o) !== (o as THREE.Mesh).castShadow) changed++;
  });
  ok(changed === 0, `every source's castShadow after a pass that threw is what it was before (${changed} changed)`);
  sb.around();
  const batchesCast = all().every((b) => b.mesh!.castShadow && b.mesh!.visible);
  sb.restore();
  ok(batchesCast, 'inside a pass every whole batch casts');
  SHADOW_PASS_TUNE.batches = false;
  sb.around();
  let swapped = 0;
  for (const b of all()) for (const s of b.plain) if (!s.mesh.castShadow && s.mesh.visible) swapped++;
  const anyCast = all().some((b) => b.mesh!.castShadow);
  sb.restore();
  SHADOW_PASS_TUNE.batches = true;
  ok(swapped === 0 && !anyCast, 'with `batches` false nothing is swapped and no batch casts');
  pass('the batches back on');
}
// A taken source whose material turns two-sided in play (a console knob moving a rule): from that pass on the source
// casts on its own and the batch hides its copies -- never both, never neither.
{
  const b = all().find((x) => x.plain.length > 0)!;
  const src = b.plain[0];
  const mat = src.mesh.material as THREE.Material;
  const was = mat.side;
  // A material of its own for the one source, so nothing else it draws moves with it.
  const own = mat.clone();
  src.mesh.material = own;
  own.side = THREE.DoubleSide;
  sb.around();
  const info = (b.mesh as unknown as { _instanceInfo: { visible: boolean }[] })._instanceInfo;
  let shown = 0;
  for (let i = 0; i < src.n; i++) if (info[src.first + i].visible) shown++;
  const castsItself = src.mesh.castShadow;
  sb.restore();
  ok(castsItself && shown === 0, `a source turned two-sided in play casts on its own inside the pass (${castsItself}) and the batch shows none of its copies (${shown} of ${src.n})`);
  src.mesh.material = mat;
  own.dispose();
  void was;
  pass('the source back on its own material');
}
// A batch the portal renderer hid for good because its draw threw: never shown again, its sources cast on their own.
{
  const b = all()[0];
  const mesh = b.mesh!;
  const { markQuarantined } = await import('../../../src/world/portalVis.ts');
  markQuarantined(mesh);
  mesh.visible = false;
  sb.around();
  let leftCasting = 0;
  let swapped = 0;
  for (const s of b.plain) {
    if (s.want !== 1) continue;
    if (s.mesh.castShadow) leftCasting++;
    else swapped++;
  }
  for (const s of b.levels) for (let j = 0; j < s.meshes.length; j++) if (s.meshes[j] && s.geo[j] >= 0 && s.want[j] === 1 && !s.meshes[j]!.castShadow) swapped++;
  const hidden = !mesh.visible && !mesh.castShadow;
  const report = sb.report();
  sb.restore();
  ok(hidden && swapped === 0 && leftCasting > 0 && report.broken === 1, `a quarantined batch stays hidden and casting nothing, and its sources are not swapped: they cast on their own (${leftCasting} casting, ${swapped} swapped, ${report.broken} broken)`);
  sb.around();
  const stillHidden = !mesh.visible;
  sb.restore();
  ok(stillHidden, 'and it is never shown again on a later pass');
  // Put back for the rest of the test (a batch the renderer never hid).
  delete mesh.userData.quarantined;
  pass('the batch back after the quarantine test');
}
// A tier unloaded takes its batch with it.
{
  const n = sb.tiers.length;
  const meshes = sb.tiers.map((b) => b.mesh!);
  h.stream.dispose();
  ok(sb.tiers.length === 0 && n > 0 && meshes.every((m) => m.parent === null), `unloading every tier dropped every batch (${n}) out of the list and the scene`);
}
// Placements made in play are none of a batch's, each reason a source is left out is its own case, and furniture and a
// level group's pieces never go in as plain sources: a second streamer, with a crate put down before its tier loads (the
// runtime loop builds it into that tier after the bulk) and another after, neither's meshes a source though both are of
// the kind a batch takes; a removal leaves the batches matching their sources.
{
  const objs: SnapshotObject[] = [];
  for (let i = 0; i < 4; i++) objs.push({ template: `object/b${i}`, model: 'block', x: -(5 + i * 12), y: 0, z: 5, q, radius: 5 });
  const h2 = await makeStreamer(objs, { defs: [BLOCK, TOWER], models: { block, tower } });
  const sb2 = new ShadowBatches(h2.scene);
  h2.stream.shadowBatches = sb2;
  cur = sb2;
  const before = h2.put('home:before', 'crate', 6, 9);
  await h2.settle({ x: 10, z: 10 }, 30);
  await before;
  sb2.buildAll();
  await h2.put('home:after', 'crate', 9, 12);
  await h2.settle({ x: 10, z: 10 }, 5);
  sb2.buildAll();
  const placed: THREE.InstancedMesh[] = [];
  for (const rec of (h2.s.runtime as Map<unknown, { meshes: THREE.Object3D[] }>).values()) for (const m of rec.meshes) m.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && placed.push(o as THREE.InstancedMesh));
  const sources = new Set<THREE.Object3D>();
  for (const b of sb2.tiers) {
    for (const p of b.plain) sources.add(p.mesh);
    for (const l of b.levels) for (const m of l.meshes) if (m) sources.add(m);
  }
  const kind = placed.filter((m) => batchable(m) === '' && m.userData.casterRadius !== undefined);
  ok(placed.length >= 2 && kind.length === placed.length, `both placements' meshes are of the kind a batch takes (${kind.length} of ${placed.length}), so leaving them out is the bulk rule's doing`);
  ok(sb2.tiers.some((b) => b.plain.length > 0) && placed.every((m) => !sources.has(m)), `neither placement made in play, before its tier loaded or after, is a batch's source (${placed.length} placed meshes, ${sources.size} sources)`);
  pass('a second world with two placements made in play');
  h2.stream.unplace('home:before');
  h2.stream.unplace('home:after');
  pass('both placements taken away');

  // Each reason a source is left out, as `batchable` judges it: a copy inside a building (on the actors' layer), a
  // mesh not at the world's origin, a material array, the sway's own depth material, a cut, a blend, morphs, a draw range.
  const g = boxGeo(1, 1, 1, 0);
  const mk = (m: THREE.Material | THREE.Material[] = new THREE.MeshStandardMaterial()): THREE.InstancedMesh => {
    const im = new THREE.InstancedMesh(g, m as THREE.Material, 1);
    im.userData.casterRadius = 1;
    return im;
  };
  const indoor = mk();
  indoor.layers.set(31);
  const moved = mk();
  moved.position.set(3, 0, 0);
  const many = mk([new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]);
  const sway = mk();
  sway.customDepthMaterial = new THREE.MeshDepthMaterial();
  const cut = mk(new THREE.MeshStandardMaterial({ alphaTest: 0.5 }));
  const blend = mk(new THREE.MeshStandardMaterial({ transparent: true }));
  const morphG = boxGeo(1, 1, 1, 0);
  morphG.morphAttributes.position = [morphG.getAttribute('position').clone()];
  const morph = new THREE.InstancedMesh(morphG, new THREE.MeshStandardMaterial(), 1);
  const rangeG = boxGeo(1, 1, 1, 0);
  rangeG.setDrawRange(0, 6);
  const range = new THREE.InstancedMesh(rangeG, new THREE.MeshStandardMaterial(), 1);
  const reasons = { layer: batchable(indoor), moved: batchable(moved), material: batchable(many), sway: batchable(sway), cut: batchable(cut), transparent: batchable(blend), geometry: batchable(morph), range: batchable(range), plain: batchable(mk()) };
  ok(reasons.layer === 'layer' && reasons.moved === 'moved' && reasons.material === 'material' && reasons.sway === 'sway' && reasons.cut === 'cut' && reasons.transparent === 'transparent' && reasons.geometry === 'geometry' && reasons.range === 'geometry' && reasons.plain === '', `each is left out by its own reason (${Object.entries(reasons).map(([k, v]) => `${k} ${v || 'taken'}`).join(', ')})`);

  // What the streamer hands over: furniture and a level group's own pieces are never plain sources.
  const plainMesh = mk();
  const furniture = mk();
  const levelPiece = mk();
  (h2.s.furnitureOfMesh as WeakMap<THREE.Object3D, unknown>).set(furniture, {});
  (h2.s.levelOfMesh as WeakMap<THREE.Object3D, unknown>).set(levelPiece, {});
  const tier = { meshes: [plainMesh, furniture, levelPiece], bulk: 3, levels: [], batch: null as TierBatch | null };
  h2.s.batchTier(tier);
  ok(tier.batch !== null && tier.batch.plain.length === 1 && tier.batch.plain[0].mesh === plainMesh, 'of a tier\'s bulk meshes the streamer hands over neither furniture nor a level group\'s own piece as a plain source');
  sb2.drop(tier.batch);
  h2.stream.dispose();
  cur = sb;
}
// The rock and the crate of the harness are none of this test's.
void ROCK;
void CRATE;
console.log(`\n${checks} checks passed`);
process.exit(0);
