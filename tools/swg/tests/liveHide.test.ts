// The world's own objects taken away and stood again, on the real streamer and the real physics (Map-maker II's twelfth wave;
// Map-maker I §2.9 as built here): the removal file's hides at an arrival (`fileByState`'s third outcome: neither filed nor
// dormant, no box to stand clear of, answering nothing, and a building's rooms taken with it), a hide and an unhide landed
// live in the world editor (`hideObject`, `showObject`, `showArrivalHidden`), the owner's switch on one thing
// (`setSolidOverride`) and on this world's copies of a template (`setWorldSolidRows`, `refreshSolid`), each over the one rule
// every collider asks (`collidesByRule`).
//
// Day one: with no removal file the streamer is cfa55f3's, its scene, tiers and counts settled and swept, held against that
// commit's streamer out of git, else to the hash of its own trace written in here.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HALL, THREE, boxGeo, loadedOf, makeStreamer, type Harness, type SnapshotObject } from './streamHarness.ts';
import { REPO } from './oldModules.ts';
import { fileByState } from '../../../src/world/worldState.ts';
import { setSolidRows, setWorldSolidRows, solidRuleOf } from '../../../src/world/walkThrough.ts';

let passed = 0;
function ok(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
}
function note(msg: string): void {
  console.log(`note ${msg}`);
}

// The world (a crate's radius 2 m, past the size rule's 1.5, so it is solid): the rock (index 0) at the game's (100, 100), two crates out in the open, and a hall with a crate in its room.
const objects: (SnapshotObject & { contained?: boolean; in?: number; cell?: number })[] = [
  { template: 'object/rock', model: 'rock', x: -100, y: 0, z: 100, q: [1, 0, 0, 0], radius: 40 },
  { template: 'object/crate', model: 'crate', x: -40, y: 0, z: 40, q: [1, 0, 0, 0], radius: 2 },
  { template: 'object/crate', model: 'crate', x: -44, y: 0, z: 40, q: [1, 0, 0, 0], radius: 2 },
  { template: 'object/hall', model: 'hall', x: -60, y: 0, z: -60, q: [1, 0, 0, 0], radius: 20 },
  { template: 'object/crate', model: 'crate', x: -62, y: 0.3, z: -60, q: [1, 0, 0, 0], radius: 2, contained: true, in: 3, cell: 1 },
];
const hallModel = () =>
  loadedOf(HALL, [
    { geometry: boxGeo(20, 8, 20, 0), cell: 0 },
    { geometry: boxGeo(18, 0.3, 18, 0), cell: 1 },
  ], [new THREE.Box3(new THREE.Vector3(-9, 0, -9), new THREE.Vector3(9, 7.5, 9))]);
const extra = (more: Record<string, unknown> = {}) => ({ defs: [HALL], models: { hall: hallModel() }, ...more });
const ROCK = { x: 100, z: 100 };
const HALL_AT = { x: 60, z: -60 };

// ---- fileByState's third outcome, pure ----------------------------------------------------------------------------------
{
  const plain = fileByState(objects, () => true);
  const none = fileByState(objects, () => true, null);
  ok(plain.hidden === null && plain.hiddenCount === 0 && [...plain.placedAt].join() === [...none.placedAt].join() && [...plain.host].join() === [...none.host].join(), 'with nothing handed over nothing is hidden and every answer is as before');
  const hall = fileByState(objects, () => true, (i) => i === 3);
  ok(hall.hiddenCount === 2 && hall.hidden![3] === 1 && hall.hidden![4] === 1 && hall.placedAt[3] < 0 && hall.placedAt[4] < 0 && hall.dormant === 0, 'a building taken away takes what stands in its rooms, neither filed nor dormant');
  ok(hall.placedAt[0] === 0 && hall.placedAt[1] === 1 && hall.placedAt[2] === 2, 'and every other object is filed in its place');
  const dormantToo = fileByState(objects, (tag) => tag !== 'x=y', (i) => i === 1);
  ok(dormantToo.dormant === 0 && dormantToo.hiddenCount === 1, 'a hidden object is never counted dormant');
}

/** The rock's top straight down at its place: 30 standing and solid, null with nothing there. */
const rockTop = (h: Harness) => h.rayDown(ROCK.x, ROCK.z, 50);

// ---- day one ------------------------------------------------------------------------------------------------------------
const OLD = 'cfa55f3';
/** The hash of cfa55f3's own trace of this scene, recorded from its streamer out of git (what a checkout with no history is held to). */
const OLD_TRACE = '71fe625da282771667f19a2b8a140219b40b1e3c';
{
  async function oldStreamer(): Promise<(new (...args: any[]) => any) | null> {
    const files = ['src/world/layoutStream.ts', 'src/world/levelGroup.ts'];
    const texts = new Map<string, string>();
    try {
      for (const f of files) texts.set(f, execFileSync('git', ['show', `${OLD}:${f}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n'));
    } catch {
      return null;
    }
    const dir = mkdtempSync(join(tmpdir(), 'mm2-w12-stream-'));
    const three = import.meta.resolve('three');
    try {
      for (const f of files) {
        const from = resolve(REPO, f, '..');
        const text = texts.get(f)!.replace(/from 'three'/g, `from '${three}'`).replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => {
          const target = resolve(from, p).replace(/\\/g, '/');
          const own = files.find((x) => resolve(REPO, x).replace(/\\/g, '/') === target);
          return `from '${own ? pathToFileURL(join(dir, own.split('/').pop()!)).href : pathToFileURL(resolve(from, p)).href}'`;
        });
        writeFileSync(join(dir, f.split('/').pop()!), text);
      }
      return (await import(pathToFileURL(join(dir, 'layoutStream.ts')).href)).LayoutStreamer;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const picture = (x: Harness): string =>
    x.scene.children
      .map((c) => {
        const m = c as THREE.InstancedMesh;
        return [c.type, m.isInstancedMesh ? m.count : -1, m.isInstancedMesh ? Array.from(m.instanceMatrix.array as Float32Array, (v) => v.toFixed(5)).join(',') : '', c.visible, m.castShadow, c.layers.mask, c.name].join('|');
      })
      .join('\n');
  const trace = async (x: Harness): Promise<string> => {
    await x.settle({ x: 60, z: 0 }, 30);
    const near = x.stream.objectsNear(60, 0, 200).map((o) => `${o.template}@${o.x.toFixed(2)},${o.z.toFixed(2)}`).sort();
    const rays = [rockTop(x), x.rayDown(40, 40, 50), x.rayDown(HALL_AT.x, HALL_AT.z, 50)];
    return [picture(x), near.join(';'), rays.join(','), `${x.s.loadedInstances}:${x.s.loadedModels}`].join('\n-- \n');
  };
  const sha = (s: string) => createHash('sha1').update(s).digest('hex');
  const now = await trace(await makeStreamer(objects, extra()));
  const Old = await oldStreamer();
  if (!Old) ok(sha(now) === OLD_TRACE, `with no removal file the streamer hashes to ${OLD}'s own trace (written in; git could not hand its streamer over): ${sha(now)}`);
  else {
    const then = await trace(await makeStreamer(objects, extra({ Streamer: Old })));
    ok(now === then, `with no removal file the streamer's scene, what it answers near, its rays and its counts are ${OLD}'s (${now.split('\n').length} lines)`);
    ok(sha(then) === OLD_TRACE, `and the hash written in here is ${OLD}'s own (${sha(then)})`);
  }
  note('the day-one trace holds the scene with no removal file; the streamer with `hidden` handed over and nothing hidden is the same streamer (fileByState answers alike, above)');
}

// ---- taken away at the arrival ------------------------------------------------------------------------------------------
{
  const h = await makeStreamer(objects, extra({ hidden: (li: number) => li === 0 || li === 3 }));
  await h.settle({ x: 60, z: 0 }, 30);
  ok(rockTop(h) === null && h.meshesAt(ROCK.x, ROCK.z) === 0, 'the rock the file hides at the arrival stands nothing and draws nothing');
  ok(h.rayDown(HALL_AT.x, HALL_AT.z, 50) === null && h.meshesAt(HALL_AT.x, HALL_AT.z) === 0 && h.meshesAt(62, -60) === 0, 'nor the hall, nor the crate in its room');
  ok(h.rayDown(40, 40, 50) !== null && h.meshesAt(40, 40) === 1, 'while a crate out in the open stands as it did');
  ok(!h.stream.objectsNear(ROCK.x, ROCK.z, 30).some((o) => o.template === 'object/rock') && !h.stream.objectsNear(HALL_AT.x, HALL_AT.z, 30).some((o) => o.template === 'object/hall'), 'and nothing taken away answers what stands near (no box to stand clear of)');
  ok(h.stream.hiddenReport().atArrival === 3, `the streamer counts the three it took away (${JSON.stringify(h.stream.hiddenReport())})`);
  const rock = h.stream.objectByRow(0)!;
  ok(!!rock && h.stream.isHidden(rock) && rock.template === 'object/rock', 'the editor finds the rock again by its layout index, hidden');
  ok(h.stream.showArrivalHidden(0) === 1, 'an unhide stands it');
  await h.settle({ x: 60, z: 0 }, 30);
  ok(Math.abs((rockTop(h) ?? 0) - 30) < 0.01 && h.meshesAt(ROCK.x, ROCK.z) === 1 && !h.stream.isHidden(rock), 'its tier is built again with it: solid at its top and drawn');
  ok(h.stream.showArrivalHidden(3) === 2, 'the hall stood again brings the crate in its room');
  await h.settle({ x: 60, z: 0 }, 30);
  ok(h.rayDown(HALL_AT.x, HALL_AT.z, 50) !== null && h.meshesAt(HALL_AT.x, HALL_AT.z) >= 1 && h.meshesAt(62, -60) === 1, 'the hall stands, its crate in its room');
  ok(h.stream.hiddenReport().atArrival === 0, 'and nothing is counted taken away any more');
}

// ---- taken away live, and stood again -------------------------------------------------------------------------------------
{
  const h = await makeStreamer(objects, extra());
  await h.settle({ x: 60, z: 0 }, 30);
  ok(Math.abs((rockTop(h) ?? 0) - 30) < 0.01 && h.meshesAt(ROCK.x, ROCK.z) === 1, 'the rock stands, solid and drawn');
  const rock = h.stream.objectByRow(0)!;
  ok(h.stream.hideObject(rock) === 1, 'a landing that hides it takes it away');
  h.physics.stepOnce();
  ok(rockTop(h) === null && h.meshesAt(ROCK.x, ROCK.z) === 0, 'at once: no collider, and its copy hidden in place in its tier');
  await h.settle({ x: 60, z: 0 }, 20);
  ok(rockTop(h) === null && h.meshesAt(ROCK.x, ROCK.z) === 0 && !h.stream.objectsNear(ROCK.x, ROCK.z, 30).some((o) => o.template === 'object/rock'), 'and the sweeps that follow make none again, nor does it answer what stands near');
  ok(h.stream.hideObject(rock) === 0, 'a second hide takes nothing more');
  ok(h.stream.showObject(rock) === 1, 'an unhide stands it again');
  await h.settle({ x: 60, z: 0 }, 20);
  ok(Math.abs((rockTop(h) ?? 0) - 30) < 0.01 && h.meshesAt(ROCK.x, ROCK.z) === 1, 'solid and drawn where it stood');
  const hall = h.stream.objectByRow(3)!;
  const hallDrawn = h.meshesAt(HALL_AT.x, HALL_AT.z);
  const crateDrawn = h.meshesAt(62, -60);
  ok(h.stream.hideObject(hall) === 2, 'the hall taken away live takes the crate in its room with it');
  await h.settle({ x: 60, z: 0 }, 20);
  ok(h.rayDown(HALL_AT.x, HALL_AT.z, 50) === null && h.meshesAt(HALL_AT.x, HALL_AT.z) === 0 && h.meshesAt(62, -60) === 0, 'neither stands nor draws');
  ok(h.meshesAt(40, 40) === 1 && h.rayDown(40, 40, 50) !== null, 'and the crates out in the open are untouched');
  ok(h.stream.showObject(hall) === 2, 'stood again, both');
  await h.settle({ x: 60, z: 0 }, 20);
  ok(h.rayDown(HALL_AT.x, HALL_AT.z, 50) !== null && h.meshesAt(HALL_AT.x, HALL_AT.z) === hallDrawn && h.meshesAt(62, -60) === crateDrawn, `the hall and its crate stand again, drawn as they were (${hallDrawn} and ${crateDrawn} copies)`);
  ok(h.tiersShareLists() > 0, "and every tier's list is still its region's own");
}

// ---- the switches ---------------------------------------------------------------------------------------------------------
{
  const h = await makeStreamer(objects, extra({ solidOf: (li: number) => (li === 1 ? false : undefined) }));
  await h.settle({ x: 60, z: 0 }, 30);
  ok(h.rayDown(40, 40, 50) === null && h.meshesAt(40, 40) === 1, "a crate the owner's switch walks through at the arrival is drawn and never solid");
  ok(h.rayDown(44, 40, 50) !== null, 'its twin of the template stands solid');
  const crate = h.stream.objectByRow(1)!;
  ok(h.stream.setSolidOverride(crate, undefined), 'the switch taken off live');
  await h.settle({ x: 60, z: 0 }, 10);
  ok(h.rayDown(40, 40, 50) !== null, 'and the sweep makes its collider again by the rule in force');
  ok(!h.stream.setSolidOverride(crate, undefined), 'taken off twice, nothing moves');
  const rock = h.stream.objectByRow(0)!;
  h.stream.setSolidOverride(rock, false);
  await h.settle({ x: 60, z: 0 }, 10);
  ok(rockTop(h) === null && h.meshesAt(ROCK.x, ROCK.z) === 1 && /walked through, by the owner's switch/.test(h.stream.ruleWords(rock)), 'a walk-through switched on live: drawn, walked through, and said so');
  h.stream.setSolidOverride(rock, undefined);
  // This world's copies of a template: every crate walked through, the narrowest row over them still the thing's own.
  setWorldSolidRows(new Map([['object/crate', false]]));
  ok(h.stream.refreshSolid(new Set(['object/crate'])) >= 1, "a world's template row moved lets that template's colliders go");
  await h.settle({ x: 60, z: 0 }, 10);
  ok(h.rayDown(40, 40, 50) === null && h.rayDown(44, 40, 50) === null && Math.abs((rockTop(h) ?? 0) - 30) < 0.01, "this world's template row walks every crate through, and the rock stands");
  h.stream.setSolidOverride(h.stream.objectByRow(2)!, true);
  await h.settle({ x: 60, z: 0 }, 10);
  ok(h.rayDown(44, 40, 50) !== null && h.rayDown(40, 40, 50) === null, "a thing's own switch wins over its world's template row");
  setWorldSolidRows(new Map());
  h.stream.refreshSolid(new Set(['object/crate']));
  await h.settle({ x: 60, z: 0 }, 10);
  ok(h.rayDown(40, 40, 50) !== null, 'and with no world row every crate is solid again by its size');
  h.stream.setSolidOverride(h.stream.objectByRow(2)!, undefined);
  // This world's row over the shared file's (`solidRuleOf`), both ways round, in the game's own rule and on the streamer.
  try {
    setSolidRows(new Map([['object/crate', true]]));
    setWorldSolidRows(new Map([['object/crate', false]]));
    h.stream.refreshSolid(new Set(['object/crate']));
    await h.settle({ x: 60, z: 0 }, 10);
    ok(solidRuleOf('object/crate') === false && h.rayDown(40, 40, 50) === null && h.rayDown(44, 40, 50) === null, "this world's row walking a crate through wins over the shared file's making it solid");
    setSolidRows(new Map([['object/crate', false]]));
    setWorldSolidRows(new Map([['object/crate', true]]));
    h.stream.refreshSolid(new Set(['object/crate']));
    await h.settle({ x: 60, z: 0 }, 10);
    ok(solidRuleOf('object/crate') === true && h.rayDown(40, 40, 50) !== null && h.rayDown(44, 40, 50) !== null, "and its row making it solid wins over the shared file's walking it through");
    setWorldSolidRows(new Map());
    h.stream.refreshSolid(new Set(['object/crate']));
    await h.settle({ x: 60, z: 0 }, 10);
    ok(solidRuleOf('object/crate') === false && h.rayDown(40, 40, 50) === null, "with no world row the shared file's word stands");
  } finally {
    setSolidRows(new Map());
    setWorldSolidRows(new Map());
  }
}

// ---- a piece of a building's own furniture, in one copy of the building ----------------------------------------------------------
// Two copies of the hall, each with its file's pieces appended after the layout (`furnishLayout`'s shape): a crate in its room
// and a crate standing in no room by its door. A piece is hidden by its own key in one copy and stands in the other, at the
// arrival (through `compileRemovals` over the very list the streamer files) and live; a copy hidden takes its pieces, the one
// in no room as well (`ilfRow`), and leaves the other copy's.
{
  const { compileRemovals } = await import('../../../src/story/removals.ts');
  const A = 'o:object/building/test/shared_hall.iff@-60,0,-60';
  const B = 'o:object/building/test/shared_hall.iff@-60,0,60';
  const two: (SnapshotObject & { contained?: boolean; in?: number; cell?: number; ilf?: string; ilfRow?: number })[] = [
    { template: 'object/building/test/shared_hall.iff', model: 'hall', x: -60, y: 0, z: -60, q: [1, 0, 0, 0], radius: 20 },
    { template: 'object/building/test/shared_hall.iff', model: 'hall', x: -60, y: 0, z: 60, q: [1, 0, 0, 0], radius: 20 },
    { template: 'object/tangible/test/shared_crate.iff', model: 'crate', x: -62, y: 0.3, z: -60, q: [1, 0, 0, 0], radius: 2, contained: true, in: 0, cell: 1, ilf: `${A}/0`, ilfRow: 0 },
    { template: 'object/tangible/test/shared_crate.iff', model: 'crate', x: -36, y: 0, z: -60, q: [1, 0, 0, 0], radius: 2, ilf: `${A}/1`, ilfRow: 0 },
    { template: 'object/tangible/test/shared_crate.iff', model: 'crate', x: -62, y: 0.3, z: 60, q: [1, 0, 0, 0], radius: 2, contained: true, in: 1, cell: 1, ilf: `${B}/0`, ilfRow: 1 },
    { template: 'object/tangible/test/shared_crate.iff', model: 'crate', x: -36, y: 0, z: 60, q: [1, 0, 0, 0], radius: 2, ilf: `${B}/1`, ilfRow: 1 },
  ];
  const hiddenBy = (ids: string[]) => {
    const c = compileRemovals(ids.map((id) => ({ id, hide: true })) as never, two);
    return { c, hidden: (li: number) => c.hidden.has(li) };
  };
  const at = { x: 40, z: 0 };
  {
    const { c, hidden } = hiddenBy([`${A}/0`, `${B}/1`]);
    ok(c.hidden.size === 2 && c.hidden.has(2) && c.hidden.has(5), "a piece's own key names that copy's piece alone");
    const h = await makeStreamer(two, extra({ hidden }));
    await h.settle(at, 30);
    // A thing in a room holds two slots (its building's furniture mesh and the old rule's one), so drawn is any.
    ok(h.meshesAt(62, -60) === 0 && h.meshesAt(62, 60) > 0, "hidden at the arrival, one copy's room crate draws nothing while the other copy's draws");
    ok(h.meshesAt(36, 60) === 0 && h.rayDown(36, 60, 50) === null && h.meshesAt(36, -60) === 1 && h.rayDown(36, -60, 50) !== null, 'and the other way round for the crates by their doors: drawn and solid only in the copy that keeps it');
  }
  {
    const { c, hidden } = hiddenBy([A]);
    ok(c.hidden.has(0) && c.hidden.has(2) && c.hidden.has(3) && !c.hidden.has(4) && !c.hidden.has(5), "a copy hidden takes both its pieces, the one in no room too, and none of the other copy's");
    const h = await makeStreamer(two, extra({ hidden }));
    await h.settle(at, 30);
    ok(h.meshesAt(36, -60) === 0 && h.rayDown(36, -60, 50) === null && h.meshesAt(62, -60) === 0, 'neither of its pieces stands');
    ok(h.meshesAt(36, 60) === 1 && h.rayDown(36, 60, 50) !== null && h.meshesAt(62, 60) > 0, "and the other copy's both do");
  }
  {
    const h = await makeStreamer(two, extra());
    await h.settle(at, 30);
    const pieceB = h.stream.objectByRow(5)!;
    ok(!!pieceB && pieceB.ilf === `${B}/1`, 'the streamer files each piece under its own key');
    ok(h.stream.hideObject(pieceB) === 1, 'hidden live, by its own row');
    h.physics.stepOnce();
    ok(h.meshesAt(36, 60) === 0 && h.rayDown(36, 60, 50) === null && h.meshesAt(36, -60) === 1 && h.rayDown(36, -60, 50) !== null, "one copy's piece goes, the other copy's stands, drawn and solid");
    ok(h.stream.showObject(pieceB) === 1, 'shown again');
    await h.settle(at, 10);
    ok(h.meshesAt(36, 60) === 1 && h.rayDown(36, 60, 50) !== null, 'and it stands again where it stood');
  }
}

// ---- what a hidden object brings with it: its effects, its basin's water, its building's doors ----------------------------------
// A lamp carrying an effect of its own model, a fountain whose basin water the world's water system draws, and a hall whose
// rooms stand doors in their doorways: each taken away live and stood again, what it brings counted through stand-ins for
// the world's particle player, water system and doors; and its copy's instance matrix put back to the bit.
const LAMP = { id: 'lamp', file: 'lamp.glb', bounds: { min: [-1, 0, -1], max: [1, 4, 1] }, triangles: 12, effects: [{ file: 'fx/flame.prt', id: 'flame', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] }] };
const FOUNTAIN = { id: 'fountain', file: 'fountain.glb', bounds: { min: [-3, 0, -3], max: [3, 1, 3] }, triangles: 24 };
const DOORHALL = { ...HALL, id: 'doorhall', file: 'doorhall.glb' };
const basin = new THREE.MeshStandardMaterial();
basin.name = 'shader/corl_fountain_water_aaes23.sht';
const fxObjects: (SnapshotObject & { contained?: boolean; in?: number; cell?: number })[] = [
  { template: 'object/lamp', model: 'lamp', x: -30, y: 0, z: 10, q: [1, 0, 0, 0], radius: 2 },
  { template: 'object/lamp', model: 'lamp', x: -34, y: 0, z: 10, q: [1, 0, 0, 0], radius: 2 },
  { template: 'object/fountain', model: 'fountain', x: -20, y: 0, z: -20, q: [1, 0, 0, 0], radius: 4 },
  { template: 'object/doorhall', model: 'doorhall', x: 60, y: 0, z: 60, q: [1, 0, 0, 0], radius: 20 },
];
const LAMP_AT = { x: 30, z: 10 };
const doorhall = loadedOf(DOORHALL, [
  { geometry: boxGeo(20, 8, 20, 0), cell: 0 },
  { geometry: boxGeo(18, 0.3, 18, 0), cell: 1 },
], [new THREE.Box3(new THREE.Vector3(-9, 0, -9), new THREE.Vector3(9, 7.5, 9))]);
// One doorway from the street to its room: what makes its rooms its own, built with doors when the player is near.
(doorhall as unknown as { portals: unknown[] }).portals = [{ passable: true, links: [{ from: 0, to: 1 }], verts: [new THREE.Vector3(-1, 0, 10), new THREE.Vector3(1, 0, 10), new THREE.Vector3(1, 2, 10), new THREE.Vector3(-1, 2, 10)], indices: [0, 1, 2, 0, 2, 3] }];
function fxWorld() {
  const placed: { file: string; h: number }[] = [];
  const removed: number[] = [];
  let next = 1;
  const effects = {
    place(file: string) {
      const h = next++;
      placed.push({ file, h });
      return h;
    },
    remove(h: unknown) {
      removed.push(h as number);
    },
  };
  return { effects, placed, removed };
}
{
  const fx = fxWorld();
  const h = await makeStreamer(fxObjects, {
    defs: [LAMP, FOUNTAIN, DOORHALL],
    models: {
      lamp: loadedOf(LAMP, [{ geometry: boxGeo(1, 4, 1, 0), cell: -1 }]),
      fountain: loadedOf(FOUNTAIN, [{ geometry: boxGeo(6, 0.5, 6, 0), cell: -1 }, { geometry: boxGeo(5, 0.1, 5, 0.6), cell: -1, material: basin }]),
      doorhall,
    },
    effects: fx.effects,
  });
  const waters: { removed: boolean }[] = [];
  h.stream.waterSurface = () => {
    const w = { removed: false, mesh: new THREE.Mesh(), remove() { w.removed = true; } };
    waters.push(w);
    return w;
  };
  const built: unknown[] = [];
  const dropped: unknown[] = [];
  (h.s.pack as { doors: unknown }).doors = {};
  h.stream.doorHost = { build: (b) => void built.push(b), drop: (b) => void dropped.push(b) };
  await h.settle({ x: 30, z: 0 }, 30);
  const lamp = h.stream.objectByRow(0)!;
  const flames = fx.placed.filter((p) => p.file === 'fx/flame.prt');
  ok(flames.length === 2 && waters.length === 1 && built.length === 1, `the two lamps' flames are placed, the fountain's water handed to the water system, the hall's doors stood with its rooms (${flames.length}, ${waters.length}, ${built.length})`);
  const slotOf = (): { mesh: THREE.InstancedMesh; i: number } | null => {
    for (const c of h.scene.children) {
      const m = c as THREE.InstancedMesh;
      if (!m.isInstancedMesh) continue;
      for (let i = 0; i < m.count; i++) {
        const e = m.instanceMatrix.array as Float32Array;
        if (Math.abs(e[i * 16 + 12] - LAMP_AT.x) < 0.01 && Math.abs(e[i * 16 + 14] - LAMP_AT.z) < 0.01) return { mesh: m, i };
      }
    }
    return null;
  };
  const slot = slotOf()!;
  const before = Array.from((slot.mesh.instanceMatrix.array as Float32Array).slice(slot.i * 16, slot.i * 16 + 16));
  ok(h.stream.hideObject(lamp) === 1, 'the lamp taken away live');
  ok(fx.removed.length === 1 && flames.some((p) => p.h === fx.removed[0]) && h.meshesAt(LAMP_AT.x, LAMP_AT.z) === 0 && h.meshesAt(34, 10) === 1, 'its flame goes with it (one of the two, its own), and it draws nothing while its twin stands');
  ok(h.stream.showObject(lamp) === 1, 'stood again');
  const after = Array.from((slot.mesh.instanceMatrix.array as Float32Array).slice(slot.i * 16, slot.i * 16 + 16));
  const again = fx.placed.filter((p) => p.file === 'fx/flame.prt');
  ok(again.length === 3 && h.meshesAt(LAMP_AT.x, LAMP_AT.z) === 1 && after.every((v, k) => Object.is(v, before[k])), "its flame placed again, and its copy's matrix put back to the bit");
  const fountain = h.stream.objectByRow(2)!;
  h.stream.hideObject(fountain);
  ok(waters[0].removed && waters.length === 1, "the fountain taken away takes its basin's water with it");
  h.stream.showObject(fountain);
  ok(waters.length === 2 && !waters[1].removed, 'and stood again its water is handed over afresh');
  const hall = h.stream.objectByRow(3)!;
  h.stream.hideObject(hall);
  ok(dropped.length === 1 && dropped[0] === built[0], "the hall taken away takes its rooms and their doors down");
  h.stream.showObject(hall);
  await h.settle({ x: 30, z: 0 }, 10);
  ok(built.length === 2, 'stood again, the next sweep builds its rooms and stands its doors again');
}

// ---- what a tier made for its copies goes with the tier ---------------------------------------------------------------------
// A live hide of the world's own object reads what the bulk made for it (its effects, its water) off its tier (`made`), so
// nothing keyed by the object, which outlives every tier it is built into, keeps a tier the player walked away from.
{
  const v8 = await import('node:v8');
  const vm = await import('node:vm');
  v8.setFlagsFromString('--expose_gc');
  const gc = vm.runInNewContext('gc') as () => void;
  const fx = fxWorld();
  const h = await makeStreamer(fxObjects.slice(0, 3), {
    defs: [LAMP, FOUNTAIN],
    models: {
      lamp: loadedOf(LAMP, [{ geometry: boxGeo(1, 4, 1, 0), cell: -1 }]),
      fountain: loadedOf(FOUNTAIN, [{ geometry: boxGeo(6, 0.5, 6, 0), cell: -1 }, { geometry: boxGeo(5, 0.1, 5, 0.6), cell: -1, material: basin }]),
    },
    effects: fx.effects,
  });
  h.stream.waterSurface = () => ({ mesh: new THREE.Mesh(), remove() {} });
  await h.settle({ x: 30, z: 0 }, 30);
  const lamp = h.stream.objectByRow(0)!;
  const ref = ((): WeakRef<object> | null => {
    const region = [...h.s.regions.values()].find((r: { objects: unknown[][] }) => r.objects[lamp.tier]?.includes(lamp));
    const t = region?.tiers[lamp.tier];
    if (!t || t === 'loading') return null;
    ok(t.made instanceof Map && t.made.has(lamp) && t.made.get(lamp).fx.length === 1, "the bulk keeps the lamp's flame on its tier, by the lamp");
    h.s.unloadTier(region, lamp.tier);
    return new WeakRef(t);
  })();
  ok(!!ref, 'the lamp\'s tier was built');
  for (let k = 0; k < 4; k++) {
    await new Promise((r) => setTimeout(r, 0));
    gc();
  }
  ok(ref!.deref() === undefined, 'unloaded, nothing of the streamer keeps the tier (its effects and water records went with it)');
  ok(!/madeFor/.test(readFileSync(join(REPO, 'src/world/layoutStream.ts'), 'utf8')), 'and no map keyed by the object reaches a tier');
}

console.log(`\n${passed} checks passed`);
