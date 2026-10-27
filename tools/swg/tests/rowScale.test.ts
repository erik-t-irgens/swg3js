// A permanent row's `scale` (DESIGN.md §2.7): read and written by the shipped reader (a number, or one a side; 1 and
// [1, 1, 1] are no scale; [s, s, s] is s; 0.001 to 1,000), tagged into the row's hash only where present, so every row
// without one hashes exactly as it did at the wave's start (`5b447b0`, read out of git); stood by the real streamer
// against the real physics at its size -- its collider's vertices scaled, its footprint, its size tier and what it is in
// the way of measured from its scaled box -- with a building with rooms standing at its own size and saying so, and a tree
// at its largest axis and saying so; its flora clearing following its size where the rule set it and left where a hand
// did; and the streamer's sites that take a scale pinned as text, each with no scale exactly as before, the bulk's among
// them (map-maker wave 3), with a scaled row folded into its tier's level group by behaviour: its copy's matrix, its level
// picked over its largest axis and its collider.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PLACEMENT_LIMITS, placementsFileText, readPlacementRow, readPlacementsFile, readScale, rowHash, scaleOf, writtenScale, type PlacementRow } from '../../../src/story/placements.ts';
// The harness first: it stands a stub in for the particle player before anything loads the streamer.
const { makeStreamer } = await import('./streamHarness.ts');
const { followClear, rowMoved } = await import('../../../src/world/permanentEdit.ts');
const { dressingStandOf } = await import('../../../src/world/permanent.ts');
const { FLORA_TAKES_ONE_SCALE, ROOMS_TAKE_NO_SCALE, largestAxis, scaledBounds } = await import('../../../src/world/layoutStream.ts');

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
/** This wave's start: the world editor's first wave, which gave a row its template and its world. */
const PRE_WAVE = '5b447b0';
let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

{
  ok(readScale(2) === 2 && readScale(0.5) === 0.5 && JSON.stringify(readScale([1, 2, 3])) === '[1,2,3]', 'a scale is a number, or one a side');
  ok(readScale([2, 2, 2]) === 2, 'three alike are one number');
  ok(readScale(0) === null && readScale(-1) === null && readScale(Number.NaN) === null && readScale([1, 2]) === null && readScale('2') === null && readScale([1, 0, 1]) === null, 'nought, negative, not a number, the wrong length or a string is refused');
  ok(readScale(PLACEMENT_LIMITS.scaleMin) === PLACEMENT_LIMITS.scaleMin && readScale(PLACEMENT_LIMITS.scaleMax) === PLACEMENT_LIMITS.scaleMax && readScale(PLACEMENT_LIMITS.scaleMax * 1.01) === null && readScale(PLACEMENT_LIMITS.scaleMin / 2) === null, `from ${PLACEMENT_LIMITS.scaleMin} to ${PLACEMENT_LIMITS.scaleMax}, a backstop`);
  const base = { id: 'a-1', kind: 'prop', pack: 'props', thing: 'chair', x: 1, y: 2, z: 3, q: [1, 0, 0, 0] };
  const r1 = readPlacementRow({ ...base, scale: 1 }) as PlacementRow;
  const r2 = readPlacementRow({ ...base, scale: [1, 1, 1] }) as PlacementRow;
  const r3 = readPlacementRow({ ...base, scale: [3, 3, 3] }) as PlacementRow;
  const unknown: string[] = [];
  readPlacementRow({ ...base, scale: 0 }, unknown);
  ok(r1.scale === undefined && r2.scale === undefined && r3.scale === 3, 'a row read with 1 or [1, 1, 1] has no scale, and [3, 3, 3] is 3');
  ok(unknown.includes('a-1.scale'), 'a scale refused is named as a field this build cannot read, and the row stands at its own size');
  ok(JSON.stringify(scaleOf({})) === '[1,1,1]' && JSON.stringify(scaleOf({ scale: 2 })) === '[2,2,2]', "a row's scale along its three axes");
  ok(writtenScale([1, 1, 1]) === undefined && writtenScale([2, 2, 2]) === 2 && JSON.stringify(writtenScale([1, 2, 1])) === '[1,2,1]', 'written: none for 1, one number for three alike, else the three');
  const text = placementsFileText('tatooine', 'raw', [{ ...(base as PlacementRow), scale: [1, 2, 1], at: 5 }]);
  ok(/"scale": \[1,2,1\]/.test(text) && readPlacementsFile(text, 'tatooine', 'ground').rows[0].scale?.toString() === '1,2,1', 'a file written with a scale reads back with it');
  const plain = { ...(base as PlacementRow) };
  ok(rowHash(plain) !== rowHash({ ...plain, scale: 2 }) && rowHash({ ...plain, scale: 2 }) !== rowHash({ ...plain, scale: [2, 2, 1] }), 'a scale moves the hash, so a row scaled is stood again');
  ok(rowHash({ ...plain, scale: 2 }) !== rowHash({ ...plain, guard: 2 }), 'and is tagged, so it can never pass for another field');
}

{
  // Every row without a scale hashes exactly as it did at the wave's start.
  let old: { rowHash: (r: PlacementRow) => string } | null = null;
  let text: string | null = null;
  try {
    text = execFileSync('git', ['show', `${PRE_WAVE}:src/story/placements.ts`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
  } catch {
    text = null;
  }
  if (text) {
    const dir = mkdtempSync(join(tmpdir(), 'rowscale-prewave-'));
    try {
      writeFileSync(join(dir, 'placements.ts'), text.replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${pathToFileURL(resolve(REPO, 'src/story', p)).href}'`));
      old = (await import(pathToFileURL(join(dir, 'placements.ts')).href)) as { rowHash: (r: PlacementRow) => string };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const rows: PlacementRow[] = [
    { id: 'a', kind: 'prop', pack: 'props', thing: 'chair', x: 1.5, y: 2, z: -3, q: [1, 0, 0, 0] },
    { id: 'b', kind: 'building', pack: 'gallery', model: 'house', x: 100, y: 5, z: 7, q: [0.7, 0, 0.7, 0], solid: true, clear: 12, guard: 3 },
    { id: 'c', kind: 'prop', pack: 'world', model: 'tree', from: 'naboo', template: 'object/tangible/test/shared_tree.iff', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], inside: true, state: 'restuss=ruins' },
  ];
  if (!old) note(`git could not hand over placements.ts as it stood at ${PRE_WAVE}: the hashes are held to the literals alone`);
  else ok(rows.every((r) => old!.rowHash(r) === rowHash(r)), `every row without a scale hashes exactly as it did at ${PRE_WAVE}`);
  ok(rowHash(rows[0]) === '["prop","props","chair",null,null,1.5,2,-3,[1,0,0,0],null,null,null,null]', 'a plain row hashes to the literal written down here');
}

{
  // The stand: a row's scale rides along only where it has one.
  const g = { x: 1, y: 2, z: 3, q: [0, 0, 0, 1] as [number, number, number, number] };
  const plain = dressingStandOf({ id: 'a', kind: 'building', pack: 'gallery', model: 'house', x: 0, y: 0, z: 0, q: [1, 0, 0, 0] }, g, 'place/a', () => null, () => false)!;
  const scaled = dressingStandOf({ id: 'a', kind: 'building', pack: 'gallery', model: 'house', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], scale: 2 }, g, 'place/a', () => null, () => false)!;
  ok(!('scale' in plain) && JSON.stringify(scaled.scale) === '[2,2,2]', 'a row with no scale stands exactly as it did, and one with a scale carries it to the stand');
  ok(largestAxis(undefined) === 1 && largestAxis({ x: 1, y: 3, z: 2 }) === 3 && JSON.stringify(scaledBounds({ min: [-1, 0, -2], max: [1, 2, 2] }, { x: 2, y: 3, z: 0.5 })) === '{"min":[-2,0,-1],"max":[2,6,1]}', 'the largest axis, and a box scaled along its own axes');
}

{
  // The real streamer and the real physics: a crate stood at a scale is solid at that size.
  const h = await makeStreamer();
  const stand = (key: string, x: number, z: number, scale?: [number, number, number], model = 'crate') => h.stream.standPermanent({ key, model, x, y: 0, z, q: [0, 0, 0, 1], inside: false, solid: true, ...(scale ? { scale } : {}) }, h.gallery as never);
  const a = stand('place/plain', 40, 40)!;
  const b = stand('place/tall', 50, 40, [2, 3, 2])!;
  await h.settle({ x: 45, z: 40 }, 30);
  const top = h.rayDown(50, 40);
  ok(h.rayDown(40, 40) !== null && Math.abs(h.rayDown(40, 40)! - 1) < 1e-3, 'a crate with no scale is solid a metre high, as before');
  ok(top !== null && Math.abs(top - 3) < 1e-3, `a crate scaled [2, 3, 2] is solid three metres high (${top?.toFixed(3)} m): its collider's vertices are scaled`);
  ok(h.rayDown(50.95, 40) !== null && h.rayDown(51.05, 40, 20) === null, 'and two metres across: solid 0.95 m from its middle and not 1.05');
  ok(JSON.stringify(b.bounds) === '{"min":[-1,0,-1],"max":[1,3,1]}' && JSON.stringify(a.bounds) === '{"min":[-0.5,0,-0.5],"max":[0.5,1,0.5]}', 'the stand answers its box at the size it stands, for its footprint and its guard');
  const near = h.stream.objectsNear(50, 41.3, 0.5);
  ok(near.some((o) => o.template === 'place/tall'), "what is in the way is measured from its scaled box: 1.3 m from its middle, half a metre's reach meets a scaled crate a plain one would not");
  ok(!h.stream.objectsNear(40, 41.3, 0.5).some((o) => o.template === 'place/plain'), 'and the plain crate is not in the way there');
  const placed = (key: string) => h.s.placedByKey.get(key);
  const big = stand('place/huge', 80, 80, [30, 30, 30])!;
  ok(placed('place/plain').sizeTier !== placed('place/huge').sizeTier, `filed in its size tier at its scaled size (${placed('place/plain').sizeTier} plain, ${placed('place/huge').sizeTier} at thirty times)`);
  ok(big.bounds!.max[1] === 30, 'its box thirty metres high');
  // A building with rooms stands at its own size, and says so.
  const hall = stand('place/hall', -60, -60, [2, 2, 2], 'hall')!;
  ok(hall.note === ROOMS_TAKE_NO_SCALE && hall.bounds!.max[1] === 8 && !placed('place/hall').scale, `a building with rooms takes no scale and says why ("${hall.note}")`);
  ok(typeof FLORA_TAKES_ONE_SCALE === 'string' && FLORA_TAKES_ONE_SCALE.length > 10, 'a tree takes its largest axis, said in words of its own');
  // Two crates at nought scale steps: nothing left behind by a removal at any size.
  h.stream.unplaceMany(['place/tall', 'place/plain', 'place/huge', 'place/hall']);
  await h.settle({ x: 45, z: 40 }, 4);
  ok(h.rayDown(50, 40) === null && h.rayDown(40, 40) === null, 'taken out, the scaled crate leaves nothing solid behind');
}

{
  // The clearing follows the size where the rule set it, and is left where a hand did.
  ok(JSON.stringify(followClear(12, 12, 24)) === '{"clear":24,"byHand":false}', "a clearing the placing rule gave follows the row's new size");
  ok(JSON.stringify(followClear(12.04, 12.03, 6)) === '{"clear":6,"byHand":false}', 'to the decimetre it is written to');
  ok(JSON.stringify(followClear(30, 12, 24)) === '{"clear":30,"byHand":true}', 'one set by hand is left as it is, and the bar says so');
  ok(JSON.stringify(followClear(undefined, 0, 0)) === '{"clear":null,"byHand":false}' && JSON.stringify(followClear(undefined, 0, 9)) === '{"clear":9,"byHand":false}', 'none where the rule gives none, and the rule\'s where it now gives some');
  const row: PlacementRow = { id: 'h-1', kind: 'building', pack: 'gallery', model: 'house', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], clear: 12 };
  const moved = rowMoved(row, { x: 1, y: 0, z: 2, q: [0, 0, 0, 1] }, [2, 2, 2], { x: 0, z: 0 }, 'raw', { clear: 24 });
  ok(moved.scale === 2 && moved.clear === 24 && moved.x === -1 && moved.z === 2, 'a row written at a new size carries its scale and its clearing');
  ok(rowMoved(row, { x: 0, y: 0, z: 0, q: [0, 0, 0, 1] }, [1, 1, 1], { x: 0, z: 0 }, 'raw').scale === undefined, 'and written back at 1 carries none');
}

{
  // The streamer's sites that take a scale, each untouched with none.
  const src = fs.readFileSync(join(REPO, 'src', 'world', 'layoutStream.ts'), 'utf8').split(/\r?\n/).join('\n');
  const pins: [RegExp, string][] = [
    [/const scale = p\.scale \?\? ONE;\s*tmpM\.compose\(tmpV\.set\(p\.x, p\.y, p\.z\), p\.q, scale\);/, 'the drawn matrix composes the scale (ONE with none)'],
    [/new THREE\.Matrix4\(\)\.compose\(tmpV\.set\(p\.x, p\.y, p\.z\), p\.q, p\.scale \?\? ONE\), name\)/, "a basin's water surface read at the scale it stands"],
    [/const m = tmpM\.compose\(tmpV\.set\(o\.x, o\.y, o\.z\), o\.q, o\.scale \?\? ONE\);/, "the colliders' matrix composes the scale"],
    [/scaleFree\(localFx\.multiplyMatrices\(tmpM, mirroredTransform\(fx\.transform, localFx\)\), p\.scale\)/, "an effect stands where the scaled model puts it, at its own size (scaleFree hands back the matrix untouched with no scale)"],
    [/isBasinWater\(prim\.material\) && isUniform\(p\.scale\)/, "a basin's water body only at a uniform scale"],
    [/stampCaster\(mesh, p\.scale \? model\.radius \* largestAxis\(p\.scale\) : model\.radius/, "a caster's radius times its largest axis, its own with none"],
    [/rowFloraParts\(model\.def, m\.elements, largestAxis\(o\.scale\)/, "a flora planting's parts at its largest axis (1 with none)"],
    [/const radius = modelReach\(o\.scale \? this\.scaledBoxOf\(o\) : def\?\.bounds\);/, 'what is in the way, from the scaled box'],
    [/const def = this\.scaledDef\(this\.defOf\(p\.model, p\.pack\), p\.scale\);/, 'a placement filed and hosted at its scaled box'],
  ];
  // The bulk's sites (map-maker wave 3: a permanent row folded into its tier's bulk carries its scale there too).
  pins.push(
    [/tmpM\.compose\(tmpV\.set\(p\.x, p\.y, p\.z\), p\.q, p\.scale \?\? ONE\);\s*mesh\.setMatrixAt\(i, tmpM\);\s*if \(p\.folded\) foldRec\(p\)\.slots\.push\(\{ mesh, i \}\);/, "the bulk's instance matrix composes a folded row's scale, and keeps its slot"],
    [/stampCaster\(mesh, scaledRadius\(model\.radius, instanced\), flora \|\| wearsCard\(prim\.material\), 0\);/, "the bulk's caster stamp at the size its biggest copy stands"],
    [/const casterRadius = scaledRadius\(model\.radius, copies\);/, "a level group's casters the same"],
    [/const open = all\.filter\(\(p\) => !p\.contained && isUniform\(p\.scale\)\);/, "the bulk's basin water only for a copy at a uniform scale"],
    [/tmpM\.compose\(tmpV\.set\(p\.x, p\.y, p\.z\), p\.q, p\.scale \?\? ONE\);\s*for \(const fx of model\.def\.effects\) placeFx\(p, this\.effectFile\(model\.def, fx\.file\), scaleFree\(/, "the bulk's model effects stand where the scale puts them, at their own size"],
    [/tmpM\.compose\(tmpV\.set\(p\.x, p\.y, p\.z\), p\.q, p\.scale \?\? ONE\);\s*for \(const fx of own\) placeFx\(p, fx\.file, scaleFree\(/, "and its template's effects"],
    [/const matrix = new THREE\.Matrix4\(\)\.compose\(tmpV\.set\(p\.x, p\.y, p\.z\), p\.q, ONE\);\s*const b: Building = /, 'a building in the bulk stands at its own size (no row with rooms carries a scale)'],
  );
  for (const [re, what] of pins) ok(re.test(src), `layoutStream: ${what}`);
  ok(/function scaledRadius\([^)]*\): number \{[\s\S]{0,300}return any \? radius \* big : radius;\s*\}/.test(src), 'a scaled radius takes the largest axis of the copies, the radius itself (untouched) where none is scaled');
  ok(/function scaleFree\(m: THREE\.Matrix4, s: THREE\.Vector3 \| undefined\): THREE\.Matrix4 \{\s*if \(!s\) return m;/.test(src), 'scaleFree hands a matrix with no scale back as it is');
  ok(/private scaledDef\([^)]*\): PackModelDef \| undefined \{\s*if \(!def \|\| !scale/.test(src), 'and scaledDef hands back the entry itself where there is no scale');
}

{
  // A folded scaled row by behaviour (map-maker wave 3): a tree with two of the client's levels stood at twice its size,
  // filed before its tier loads, so it goes into the tier's level group -- its copy's matrix at its scale, its distance to
  // each level taken over its largest axis, and its collider scaled.
  const TREE = { id: 'tree', file: 'tree.glb', bounds: { min: [-1, 0, -1], max: [1, 10, 1] }, triangles: 24 };
  const { loadedOf, boxGeo, THREE } = await import('./streamHarness.ts');
  const tree = loadedOf(TREE, [{ geometry: boxGeo(2, 10, 2, 0), cell: -1 }]) as any;
  tree.levels = [
    { near: 0, far: 60, level: 0, primitives: [tree.primitives[0]] },
    { near: 60, far: 1e9, level: 1, primitives: [{ geometry: boxGeo(2, 10, 2, 0), material: tree.primitives[0].material, cell: -1 }] },
  ];
  const h = await makeStreamer(undefined, { defs: [TREE], models: { tree } });
  const st = (key: string, x: number, scale?: [number, number, number]) => h.stream.standPermanent({ key, model: 'tree', x, y: 0, z: 60, q: [0, 0, 0, 1], inside: false, solid: true, ...(scale ? { scale } : {}) } as never, h.s.pack);
  st('place/plain-tree', 40);
  st('place/big-tree', 60, [2, 2, 2]);
  await h.settle({ x: 50, z: 60 }, 30);
  const big = h.s.foldOf.get(h.s.placedByKey.get('place/big-tree'));
  const plain = h.s.foldOf.get(h.s.placedByKey.get('place/plain-tree'));
  // Each in a level group of its own size (`sizeBuckets`): a group casts by the rule at its biggest copy's size, and the
  // trees at their own size are never judged by a row's scale.
  ok(!!big?.level && !!plain?.level && big.level.group !== plain.level.group, 'both trees are folded into level groups, each of its own size');
  ok(plain.level.group.meshes.every((x: THREE.InstancedMesh) => x.userData.casterRadius === tree.radius) && big.level.group.meshes.every((x: THREE.InstancedMesh) => x.userData.casterRadius === tree.radius * 2), "the plain tree's group casts at the tree's own radius, the big one's at twice it");
  const m = big.level.group.matrixOf(big.level.i, new THREE.Matrix4());
  const s = new THREE.Vector3();
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  const sp = new THREE.Vector3();
  plain.level.group.matrixOf(plain.level.i, new THREE.Matrix4()).decompose(new THREE.Vector3(), new THREE.Quaternion(), sp);
  ok(Math.abs(s.x - 2) < 1e-6 && Math.abs(s.y - 2) < 1e-6 && Math.abs(sp.y - 1) < 1e-6, `the scaled copy's matrix in the level group is at its scale (${s.y.toFixed(3)}), the plain one's at its own`);
  const g = big.level.group;
  const gp = plain.level.group;
  // Its level picked over its largest axis: 100 m off, the plain tree is past its first switch (60 m) and the big one not.
  gp.sweep(40, 5, 160, 1, 1e9);
  const lvPlain = gp.level[plain.level.i];
  g.sweep(60, 10, 165, 1, 1e9);
  const lvBig = g.level[big.level.i];
  ok(lvPlain === 1 && lvBig === 0, `its level picked over its largest axis: at 100 m the plain tree draws its coarse level (${lvPlain}) and the big one still its finest (${lvBig})`);
  // Its middle measured where its scale puts it (the box's middle 5 m up, twice that at twice the size): straight over the
  // big tree, an eye just inside its switch measured from the scaled middle (60 m taken twice over its largest axis, and
  // the hysteresis over that) and just past it measured from the unscaled one, five metres lower, keeps its finest level.
  const { LOD_LEVEL_TUNE } = await import('../../../src/world/lodLevels.ts');
  const sw = 2 * 60 * (1 + LOD_LEVEL_TUNE.hysteresis) - 2;
  g.sweep(60, 0, 165, 1, 1e9);
  g.sweep(60, 10 + sw, 60, 1, 1e9);
  ok(g.level[big.level.i] === 0, `its middle is where its scale puts it: ${sw} m over its scaled middle it keeps its finest level, where 5 m further (from the middle unscaled) it would not`);
  g.sweep(60, 10 + sw + 6, 60, 1, 1e9);
  ok(g.level[big.level.i] === 1, 'and a little higher it takes its coarse level, so the line is where the scaled middle puts it');
  // The group's sphere grown by the model's radius at its biggest copy's scale: it only decides when the whole group may be
  // settled at once, which picks what each copy's own middle would (a copy's level is taken from its middle alone), so no
  // level depends on it and it is held as text.
  const lg = (await import('node:fs')).readFileSync(new URL('../../../src/world/levelGroup.ts', import.meta.url), 'utf8');
  ok(/this\.sr = Math\.hypot\(x1 - x0, y1 - y0, z1 - z0\) \/ 2 \+ Math\.max\(0, radius\) \* most;/.test(lg) && /if \(big > most\) most = big;/.test(lg), "the group's sphere is grown by the radius at its biggest copy's scale (text: no level depends on it)");
  const top = h.rayDown(60, 60, 40);
  const topPlain = h.rayDown(40, 60, 40);
  ok(top !== null && Math.abs(top - 20) < 1e-3 && topPlain !== null && Math.abs(topPlain - 10) < 1e-3, `its collider scaled: twenty metres high (${top?.toFixed(3)}), the plain one ten`);
}

console.log(`\n${checks} checks passed`);
