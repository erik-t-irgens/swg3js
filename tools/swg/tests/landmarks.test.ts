// Big things seen far away (the horizon pass's wave 5b, DESIGN.md §1b; the render handoff's Part B step 1): the landmark index
// over the real streamer and the real physics (`streamHarness.ts`), its rules, the placement rows' two fields, and day one.
//
// Run: node tools/swg/tests/landmarks.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROCK, THREE, boxGeo, loadedOf, makeStreamer, gatePrepare, type Harness, type SnapshotObject } from './streamHarness.ts';
import { REPO, loadOld } from './oldModules.ts';
import { LandmarkIndex, lowestPieces } from '../../../src/world/landmarks.ts';
import { LANDMARK_DEFAULTS, LANDMARK_MIN_SIZE_FLOOR, LANDMARK_TUNE, farCopyWords, farTilesReach, isLandmark, landmarkRange, landmarkSweepDue, landmarkWants, tuneLandmarks } from '../../../src/world/landmarkMath.ts';
import { LANDMARK_DIALS, MIN_SIZE_TAKEN } from '../../../src/world/landmarkDials.ts';
import { RowMaterials } from '../../../src/world/rowMaterials.ts';
import { PLACED_TIERS } from '../../../src/world/placedTiers.ts';
import { PLACEMENT_FIELDS, PLACEMENT_LIMITS, placementsFileText, readPlacementRow, readPlacementsFile, rowHash, type PlacementRow } from '../../../src/story/placements.ts';
import { dressingStandOf } from '../../../src/world/permanent.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const BASE = 'b9c1611';
/** The hash of b9c1611's own streamer's trace of the day-one scene, recorded from it out of git (what a checkout with no history is held to). */
const BASE_TRACE = 'feb2402b3b8fa37371a19e6df38911a76e021833';
/** The hash of b9c1611's reader's `rowHash` over this test's corpus of rows carrying every field of before, recorded from it. */
const CORPUS_HASH = '58d33ddbe8a95d33b2c86de9840b2750bf2f5de8';
const reset = () => Object.assign(LANDMARK_TUNE, LANDMARK_DEFAULTS);

// ---- the rules ------------------------------------------------------------------------------------------------------------
{
  ok(!LANDMARK_DEFAULTS.on && LANDMARK_DEFAULTS.k === 400 && LANDMARK_DEFAULTS.minSize === 12, 'the size rule ships off, at 400 half-spans and 12 m');
  ok(isLandmark(12, false, 0, true, 12) && !isLandmark(11.9, false, 0, true, 12) && !isLandmark(50, false, 0, false, 12), 'by size: 12 m and over with the rule on, nothing with it off');
  ok(isLandmark(0.5, true, 0, false, 12) && isLandmark(0.5, false, 300, false, 12), "a row's own `landmark` or `drawDistance` makes one whatever its size and whether the rule is on or not");
  ok(landmarkRange(15, 0, 400) === 6000 && landmarkRange(15, 800, 400) === 800 && landmarkRange(0.5, 9000, 400) === 9000, "k half-spans, else the row's own reach, both ways (a big wall let go early, a small beacon kept far)");
  ok(landmarkWants(3000, 3328, false, 0.05, false) && !landmarkWants(3200, 3328, false, 0.05, false) && landmarkWants(3450, 3328, true, 0.05, false) && !landmarkWants(3500, 3328, true, 0.05, false), 'drawn inside the cut less its band, kept to the cut and its band once drawn');
  ok(!landmarkWants(10, 3328, true, 0.05, true), 'never while the streamer holds it finer');
  ok(farTilesReach(6, 512) === 3328, "the far tiles' reach at the default six: 3.3 km");
  ok(landmarkSweepDue(0, 9, 3000, 3000) && landmarkSweepDue(0.3, 0, 3000, 3000) && landmarkSweepDue(0, 0, 3100, 3000) && !landmarkSweepDue(0.1, 2, 3010, 3000), 'a sweep is due on 8 m moved, a quarter second, or the reach moving 2%');
  const said = tuneLandmarks({ k: 600, minSize: -3, loads: 2.6, drawn: 'off', on: true, nope: 1 });
  ok(LANDMARK_TUNE.k === 600 && LANDMARK_TUNE.minSize === LANDMARK_MIN_SIZE_FLOOR && LANDMARK_TUNE.loads === 3 && LANDMARK_TUNE.drawn === false && !LANDMARK_TUNE.on, `the tune takes numbers held to their floors and a switch, and leaves 'on' to the console (${said.join('; ')})`);
  ok(said.length === 2, 'and says what it would not take');
  // The review round: the index asks the size rule only of the streamer's first size tier, so a least half-span under that
  // tier's own collects nothing more; the tune and the dial both stop there, and the editor's words cannot promise past it.
  tuneLandmarks({ minSize: 5 });
  ok(LANDMARK_MIN_SIZE_FLOOR === PLACED_TIERS[0].minRadius && LANDMARK_TUNE.minSize === PLACED_TIERS[0].minRadius, `the least half-span is never under the first size tier's own (${LANDMARK_MIN_SIZE_FLOOR} m): 5 is held there`);
  const minDial = LANDMARK_DIALS.groups.flatMap((g) => g.dials).find((d) => d.key === 'tune.minSize');
  ok(minDial?.kind === 'number' && minDial.min === PLACED_TIERS[0].minRadius, "and the dial's least is that tier's, not 3 m");
  const dialSaid = minDial?.kind === 'number' ? minDial.set(30) : [];
  ok(LANDMARK_TUNE.minSize === 30 && dialSaid.includes(MIN_SIZE_TAKEN) && /curtain/.test(MIN_SIZE_TAKEN), `the dial writes it and says it is taken behind a curtain or at the next arrival, never by a frame ("${dialSaid.join('; ')}")`);
  reset();
  ok(/6000 m by its size, by its own word/.test(farCopyWords({ landmark: true }, 15)) && /800 m, its own reach/.test(farCopyWords({ drawDistance: 800 }, 15)) && /size rule is off/.test(farCopyWords({}, 15)), "the editor's words: its own word, its own reach, or the rule off");
  LANDMARK_TUNE.on = true;
  ok(/6000 m by its size/.test(farCopyWords({}, 15)) && /under the size rule's 12 m/.test(farCopyWords({}, 3)), 'and by the size rule on, or under its least');
  ok(/building's rooms, which have no far copy/.test(farCopyWords({ inside: true }, 15)) && /no far copy/.test(farCopyWords({ inside: true, landmark: true, drawDistance: 800 }, 15)), "a row in a building's rooms is told it has no far copy, whatever it carries (the index leaves every contained thing out)");
  reset();
}

// ---- the rows' two fields -------------------------------------------------------------------------------------------------
{
  const base = { id: 'tower-1', kind: 'building', pack: 'gallery', model: 'tower', x: 1, y: 2, z: 3, q: [1, 0, 0, 0] };
  const read = (extra: Record<string, unknown>) => {
    const unknown: string[] = [];
    const r = readPlacementRow({ ...base, ...extra }, unknown);
    return { r: r as PlacementRow, unknown };
  };
  ok(read({ landmark: true }).r.landmark === true && read({ landmark: false }).r.landmark === undefined && !read({ landmark: false }).unknown.length, '`landmark: true` is kept, `false` reads as absent with no note');
  ok(read({ landmark: 'yes' }).unknown.includes('tower-1.landmark'), 'anything else is kept out with its note');
  ok(read({ drawDistance: 6000 }).r.drawDistance === 6000 && read({ drawDistance: 0.5 }).unknown.includes('tower-1.drawDistance') && read({ drawDistance: PLACEMENT_LIMITS.drawDistanceMax + 1 }).r.drawDistance === undefined && read({ drawDistance: 'far' }).unknown.length === 1, 'a reach in metres within the limits, else kept out with its note');
  const mark = { id: 'm-1', kind: 'mark', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], attach: [{ fx: 'tatooine:fx.json' }], landmark: true, drawDistance: 500 };
  const mu: string[] = [];
  const m = readPlacementRow(mark, mu) as PlacementRow;
  ok(typeof m === 'object' && m.landmark === undefined && m.drawDistance === undefined && mu.includes('m-1.landmark') && mu.includes('m-1.drawDistance'), 'a mark takes neither (it has no model to be seen)');
  const plain = read({}).r;
  const hashed = rowHash({ ...plain, landmark: true, drawDistance: 5000 });
  ok(hashed !== rowHash(plain) && /"landmark",true,"drawDistance",5000\]$/.test(hashed) && rowHash({ ...plain, drawDistance: 5000 }) !== rowHash({ ...plain, landmark: true }), "both are in the row's hash, tagged, only where present");
  const order = PLACEMENT_FIELDS;
  ok(order.indexOf('landmark') === order.indexOf('furniture') + 1 && order.indexOf('drawDistance') === order.indexOf('landmark') + 1 && order.indexOf('scale') === order.indexOf('drawDistance') + 1, 'written after `furniture` and before `scale`');
  const text = placementsFileText('tatooine', 'raw', [{ ...plain, landmark: true, drawDistance: 5000 }]);
  ok(text.includes('"landmark": true, "drawDistance": 5000'), 'and a file writes them');
  const back = readPlacementsFile(text, 'tatooine', 'ground');
  ok(back.rows[0]?.landmark === true && back.rows[0]?.drawDistance === 5000, 'and reads them back');
  const g = { x: 1, y: 2, z: 3, q: [1, 0, 0, 0] as [number, number, number, number] };
  const stand = dressingStandOf({ ...plain, landmark: true, drawDistance: 5000 }, g as never, 'place/tower-1', () => null, () => false);
  const bare = dressingStandOf(plain, g as never, 'place/tower-1', () => null, () => false);
  ok(stand?.landmark === true && stand.drawDistance === 5000 && bare !== null && !('landmark' in bare) && !('drawDistance' in bare), "the stand carries them to the streamer only where the row has them");

  // Day one: every row of every placements file on disk (the owner's own, read and never written) hashes and writes as
  // b9c1611's reader made it, and so does a corpus of rows written here with every field of before.
  const old = await loadOld<{ rowHash: (r: PlacementRow) => string; placementsFileText: (w: string, f: string, rows: PlacementRow[]) => string }>(['src/story/placements.ts'], 'src/story/placements.ts', BASE);
  const files: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (/\.json$/.test(e.name) && /placements[\\/](story|world)[\\/]/.test(join(d, e.name))) files.push(join(d, e.name));
    }
  };
  walk(join(REPO, 'public', 'placements'));
  const corpus: PlacementRow[] = [
    plain,
    { ...plain, id: 'b', scale: [1, 2, 3], solid: false, clear: 4, guard: 2, state: 'restuss=ruins', template: 'object/building/x.iff', furnish: false, furniture: 'none' } as PlacementRow,
    { id: 'c', kind: 'prop', pack: 'props', thing: 'crate', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], inside: true, mats: [{ of: '*', tint: '#ff0000' }] } as PlacementRow,
  ];
  let rows = 0;
  let same = 0;
  let sameText = 0;
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    const world = f.replace(/\\/g, '/').split('/').pop()!.replace(/\.json$/, '');
    const frame = world.startsWith('space_') ? 'game' : 'raw';
    const now = readPlacementsFile(t, world, world.startsWith('space_') ? 'space' : 'ground').rows.filter((r) => r.landmark === undefined && r.drawDistance === undefined);
    for (const r of now) {
      rows++;
      if (!old || old.rowHash(r) === rowHash(r)) same++;
    }
    if (!old || old.placementsFileText(world, frame, now) === placementsFileText(world, frame, now)) sameText++;
  }
  for (const r of corpus) {
    rows++;
    if (!old || old.rowHash(r) === rowHash(r)) same++;
  }
  const corpusHash = createHash('sha1').update(corpus.map((r) => rowHash(r)).join('\n')).digest('hex');
  ok(corpusHash === CORPUS_HASH, `the corpus of every field of before hashes to ${BASE}'s reader's own answer, written in (${corpusHash})`);
  if (!old) note(`git could not hand ${BASE}'s reader over: the files on disk were read but not compared`);
  else {
    ok(same === rows, `every row of before (${rows}: ${files.length} placements files on disk and a corpus of every field) hashes as ${BASE}'s reader hashed it`);
    ok(sameText === files.length, `and every file of them writes byte for byte as ${BASE}'s did (${files.length})`);
  }
}

// ---- the index over the real streamer -------------------------------------------------------------------------------------
// Rocks (26 m across, 30 high: a half-span of 15, the first tier, kept to 6 km by size) at the game's (100, 100), (0, 3000) and
// (0, 5000); the snapshot's frame mirrors x about a centre of nought.
const ROCKS: SnapshotObject[] = [
  { template: 'object/rock', model: 'rock', x: -100, y: 0, z: 100, q: [1, 0, 0, 0], radius: 40 },
  { template: 'object/rock', model: 'rock', x: 0, y: 0, z: 3000, q: [1, 0, 0, 0], radius: 40 },
  { template: 'object/rock', model: 'rock', x: 0, y: 0, z: 5000, q: [1, 0, 0, 0], radius: 40 },
];
/** How many copies anything draws at (x, z) now: visible meshes only, each at its count (a landmark's hidden mesh draws nothing). */
function drawnAt(h: Harness, x: number, z: number): number {
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let n = 0;
  for (const c of h.scene.children) {
    const mesh = c as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || !mesh.visible) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      v.setFromMatrixPosition(m);
      if (Math.abs(v.x - x) < 0.01 && Math.abs(v.z - z) < 0.01) n++;
    }
  }
  return n;
}
function landmarkMeshes(h: Harness): THREE.InstancedMesh[] {
  return h.scene.children.filter((c) => c.name === 'landmark') as THREE.InstancedMesh[];
}
async function frame(h: Harness, lm: LandmarkIndex<never>, x: number, z: number, reach: number, dt = 0.02): Promise<void> {
  await h.settle({ x, z }, 1);
  lm.ask.eyeX = x;
  lm.ask.eyeY = 1.7;
  lm.ask.eyeZ = z;
  lm.ask.reach = reach;
  lm.ask.dt = dt;
  lm.step();
}

// Day one: with the switch off and no row's field, nothing is collected, loaded or drawn, and the streamer is b9c1611's.
{
  reset();
  const picture = (x: Harness): string =>
    x.scene.children
      .map((c) => {
        const m = c as THREE.InstancedMesh;
        return [c.type, m.isInstancedMesh ? m.count : -1, m.isInstancedMesh ? Array.from(m.instanceMatrix.array as Float32Array, (v) => v.toFixed(5)).join(',') : '', c.visible, m.castShadow, c.layers.mask, c.name].join('|');
      })
      .join('\n');
  const trace = async (x: Harness, withIndex: boolean): Promise<string> => {
    // A permanent row of the first tier and a crate put down, one taken up again later: `place` and `unplace` as rows land.
    await x.stream.place({ model: 'rock', template: 'place/r', x: 600, y: 0, z: 600, q: new THREE.Quaternion(), radius: 13, fold: true });
    await x.stream.place({ model: 'crate', template: 'place/c', x: 40, y: 0, z: 2000, q: new THREE.Quaternion(), radius: 0.5, fold: true });
    const lm = withIndex ? new LandmarkIndex(x.stream as never) : null;
    if (lm) await lm.build();
    const steps: string[] = [];
    for (const z of [0, 500, 1500, 2500, 3000, 1000, 0]) {
      if (z === 1000) x.stream.unplace('place/r');
      await x.settle({ x: 0, z }, 4);
      if (lm) {
        lm.ask.eyeZ = z;
        lm.ask.reach = 3328;
        lm.ask.dt = 0.3;
        lm.step();
      }
      steps.push(picture(x), `${x.s.loadedInstances}:${x.s.loadedModels}`);
    }
    return [...steps, lm ? `${lm.groupCount}` : '0'].join('\n-- \n');
  };
  const sha = (s: string) => createHash('sha1').update(s).digest('hex');
  const h = await makeStreamer(ROCKS);
  const before = h.scene.children.length;
  const lm = new LandmarkIndex(h.stream as never);
  await lm.build();
  ok(lm.groupCount === 0 && h.scene.children.length === before && landmarkMeshes(h).length === 0, 'with the size rule off and no row carrying a field, the index collects, loads and adds nothing');
  const now = await trace(await makeStreamer(ROCKS), true);
  const Old = await loadOld<{ LayoutStreamer: new (...a: any[]) => any }>(['src/world/layoutStream.ts'], 'src/world/layoutStream.ts', BASE);
  if (!Old) ok(sha(now) === BASE_TRACE, `with the switch off and no field the streamer hashes to ${BASE}'s own trace (written in; git could not hand its streamer over): ${sha(now)}`);
  else {
    const then = await trace(await makeStreamer(ROCKS, { Streamer: Old.LayoutStreamer }), false);
    ok(now === then, `with the switch off and no field, the streamer stepped beside the index draws, loads and counts exactly what ${BASE}'s streamer does over a walk to 3 km and back, a row put down and one taken up (${now.split('\n').length} lines)`);
    ok(sha(then) === BASE_TRACE, `and the hash written in here is ${BASE}'s own (${sha(then)})`);
  }
}

// Switched on: a copy past its tier's range is drawn, the nearest is the tier's, the far one past the reach is not.
{
  reset();
  LANDMARK_TUNE.on = true;
  const h = await makeStreamer(ROCKS);
  const lm = new LandmarkIndex(h.stream as never);
  await h.settle({ x: 0, z: 0 }, 20);
  await lm.build();
  ok(lm.groupCount === 1 && (lm.report().members as number) === 3, `the three rocks collected as one group (${JSON.stringify(lm.report().members)})`);
  const meshes = landmarkMeshes(h);
  ok(meshes.length === 1 && !meshes[0].castShadow && meshes[0].receiveShadow && meshes[0].instanceMatrix.count === 3, "its lowest level's one piece, room for three, casting no shadow (Light and shadow's)");
  await frame(h, lm as never, 0, 0, 3328, 0.3);
  ok(drawnAt(h, 100, 100) === 1 && h.stream.holdsFiner(h.s.objects[0]), 'the near rock is drawn once, by its own tier, which holds it finer');
  ok(drawnAt(h, 0, 3000) === 1 && !h.stream.holdsFiner(h.s.objects[1]), "the rock 3 km off, past its tier's 1.7 km, is drawn by the index");
  ok(drawnAt(h, 0, 5000) === 0, "the rock 5 km off is past the far tiles' reach in force (3.3 km) and drawn by nothing");
  await frame(h, lm as never, 0, 0, 9000, 0.3);
  ok(drawnAt(h, 0, 5000) === 1, 'with the rings reaching 9 km it is drawn (its size keeps it to 6 km)');
  LANDMARK_TUNE.k = 300;
  await frame(h, lm as never, 0, 0, 9000, 0.01);
  ok(drawnAt(h, 0, 5000) === 0 && drawnAt(h, 0, 3000) === 1, 'k moved live to 300 (4.5 km for a 15 m half-span): the 5 km rock goes at the next frame, nothing collected again');
  LANDMARK_TUNE.k = 400;
  LANDMARK_TUNE.drawn = false;
  await frame(h, lm as never, 0, 0, 9000, 0.01);
  ok(drawnAt(h, 0, 3000) === 0 && drawnAt(h, 0, 5000) === 0 && drawnAt(h, 100, 100) === 1, 'the drawn switch off hides every landmark copy and nothing of the tiers');
  LANDMARK_TUNE.drawn = true;

  // The hand-over: walking to the rock 3 km off and back, it is drawn exactly once at every step it is within its cut.
  let twice = 0;
  let none = 0;
  let steps = 0;
  for (let z = 0; z <= 2900; z += 50) {
    await frame(h, lm as never, 0, z, 3328);
    steps++;
    const n = drawnAt(h, 0, 3000);
    if (n > 1) twice++;
    if (n < 1) none++;
  }
  for (let z = 2900; z >= 0; z -= 50) {
    await frame(h, lm as never, 0, z, 3328);
    steps++;
    const n = drawnAt(h, 0, 3000);
    if (n > 1) twice++;
    if (n < 1) none++;
  }
  ok(twice === 0 && none === 0, `walking 3 km to the far rock and back, it is drawn once at every one of ${steps} steps: never by both (${twice}), never by neither (${none})`);
  ok((lm.report().heldFiner as number) >= 1, 'and the index counts the copies its tiers held');

  // The band: a copy drawn stays drawn a step past its cut, one not drawn comes in only a step inside it.
  await frame(h, lm as never, 0, 0, 9000, 0.3);
  await frame(h, lm as never, 0, 0, 3000 / 1.04, 0.3);
  ok(drawnAt(h, 0, 3000) === 1, 'drawn, it stays drawn with the reach cut to 4% under its distance (the 5% band)');
  await frame(h, lm as never, 0, 0, 3000 / 1.06, 0.3);
  ok(drawnAt(h, 0, 3000) === 0, 'and goes past the band');
  await frame(h, lm as never, 0, 0, 3000 / 0.97, 0.3);
  ok(drawnAt(h, 0, 3000) === 0, 'and does not come back until it is a band inside its cut');
  await frame(h, lm as never, 0, 0, 3000 / 0.94, 0.3);
  ok(drawnAt(h, 0, 3000) === 1, 'and comes back there');

  // A row put down far off with its own fields: a small crate kept to its own 1,500 m, a big rock let go early at 800 m.
  await h.stream.place({ model: 'crate', template: 'place/beacon', x: 1000, y: 0, z: 0, q: new THREE.Quaternion(), radius: 0.5, drawDistance: 1500 });
  await h.stream.place({ model: 'rock', template: 'place/wall', x: -2500, y: 0, z: 0, q: new THREE.Quaternion(), radius: 13, drawDistance: 800 });
  await h.stream.place({ model: 'crate', template: 'place/small', x: 0, y: 0, z: -1000, q: new THREE.Quaternion(), radius: 0.5 });
  await frame(h, lm as never, 0, 0, 9000, 0.6);
  await lm.ready;
  await frame(h, lm as never, 0, 0, 9000, 0.3);
  ok((lm.report().members as number) === 5 && lm.groupCount === 2, `collected again after a burst of three placements: the beacon and the wall join, the plain crate does not (${String(lm.report().members)} in ${lm.groupCount} groups)`);
  ok(drawnAt(h, 1000, 0) === 1, "the crate's own 1,500 m keeps it past its tier's 320 m (a small beacon kept far)");
  ok(drawnAt(h, -2500, 0) === 0, 'the rock row with its own 800 m is let go 2.5 km off, where its size would keep it to 6 km (a big wall let go early)');
  ok(drawnAt(h, 0, -1000) === 0, 'the plain crate is no landmark');
  h.stream.unplace('place/beacon');
  await frame(h, lm as never, 0, 0, 9000, 0.6);
  await lm.ready;
  await frame(h, lm as never, 0, 0, 9000, 0.3);
  ok(drawnAt(h, 1000, 0) === 0 && (lm.report().members as number) === 4, 'taken up, it goes from the index too');

  // A switch moved is taken by a collection behind a screen or a curtain (`setLandmarks` asks `standLandmarks`), never by
  // the frame, which would load models on a live frame the other way round (the review round).
  LANDMARK_TUNE.on = false;
  const buildsBefore = lm.report().builds as number;
  await frame(h, lm as never, 0, 0, 9000, 0.6);
  await lm.ready;
  await frame(h, lm as never, 0, 0, 9000, 0.3);
  ok(lm.pending && (lm.report().members as number) === 4 && (lm.report().builds as number) === buildsBefore, 'the switch moved: the frame collects nothing and says it waits (`pending`)');
  // A switch off collects again with only the rows' own fields.
  await lm.build();
  await frame(h, lm as never, 0, 0, 9000, 0.3);
  ok(!lm.pending && (lm.report().members as number) === 1 && drawnAt(h, 0, 3000) === 0, 'the size rule off, taken: only the row carrying its own reach stays a member');
  lm.dispose();
  ok(landmarkMeshes(h).length === 0, "let go, its meshes are out of the scene (the model's geometry and materials are the pack's)");
  reset();
}

// The review round: a least half-span moved is never collected by a frame (a lower one brings in models no tier has drawn);
// the frame's own collections (rows put down or taken up) keep the rule last taken behind a screen or a curtain.
{
  reset();
  LANDMARK_TUNE.on = true;
  const h = await makeStreamer(ROCKS);
  const lm = new LandmarkIndex(h.stream as never);
  await h.settle({ x: 0, z: 0 }, 20);
  await lm.build();
  const members = () => lm.report().members as number;
  ok(members() === 3 && !lm.pending, 'the three rocks (15 m half-spans) collected at 12 m');
  tuneLandmarks({ minSize: 20 });
  const builds = lm.report().builds as number;
  await frame(h, lm as never, 0, 0, 3328, 0.6);
  await lm.ready;
  await frame(h, lm as never, 0, 0, 3328, 0.3);
  ok(members() === 3 && lm.pending && (lm.report().builds as number) === builds && drawnAt(h, 0, 3000) === 1, 'the least half-span moved to 20 m: the frame collects nothing (`pending`), the rocks stay');
  await h.stream.place({ model: 'crate', template: 'place/beacon', x: 1000, y: 0, z: 0, q: new THREE.Quaternion(), radius: 0.5, drawDistance: 1500 });
  await frame(h, lm as never, 0, 0, 3328, 0.6);
  await lm.ready;
  await frame(h, lm as never, 0, 0, 3328, 0.3);
  ok(members() === 4 && lm.pending, `a row put down meanwhile is collected by the rule last taken: the beacon joins and the rocks stay (${members()})`);
  await lm.build();
  await frame(h, lm as never, 0, 0, 3328, 0.3);
  ok(members() === 1 && !lm.pending && drawnAt(h, 0, 3000) === 0, 'taken by a collection behind a curtain (`build()`): only the beacon is left');
  lm.dispose();
  reset();
}

// The review round: a group made again for its members (a row of its model put down elsewhere) keeps every copy drawn inside
// the band drawn, where a fresh group's copies all started hidden and one standing in the band went until the eye came nearer.
{
  reset();
  LANDMARK_TUNE.on = true;
  const h = await makeStreamer(ROCKS);
  const lm = new LandmarkIndex(h.stream as never);
  await h.settle({ x: 0, z: 0 }, 20);
  await lm.build();
  const reach = 3000 / 1.04;
  await frame(h, lm as never, 0, 0, 9000, 0.3);
  await frame(h, lm as never, 0, 0, reach, 0.3);
  ok(drawnAt(h, 0, 3000) === 1, 'the rock 3 km off drawn, standing inside the band of a cut 4% under its distance');
  const builds = lm.report().builds as number;
  await h.stream.place({ model: 'rock', template: 'place/far', x: -2000, y: 0, z: -2000, q: new THREE.Quaternion(), radius: 13 });
  await frame(h, lm as never, 0, 0, reach, 0.6);
  await lm.ready;
  await frame(h, lm as never, 0, 0, reach, 0.3);
  ok((lm.report().builds as number) === builds + 1 && (lm.report().members as number) === 4, 'a rock of the same model put down 2.8 km off makes its group again');
  ok(drawnAt(h, 0, 3000) === 1, 'and the copy drawn inside the band stays drawn across the swap (its state carried by the object)');
  await frame(h, lm as never, 0, 0, 3000 / 1.06, 0.3);
  ok(drawnAt(h, 0, 3000) === 0, 'and still goes once it is past the band');
  lm.dispose();
  reset();
}

// The review round: a row whose look borrows another model's picture wears it at distance too: its donor is loaded with the
// group, as a tier's build and the runtime path load it, where the index had loaded the row's own model alone.
{
  reset();
  LANDMARK_TUNE.on = true;
  const TOWER = { id: 'tower', file: 'tower.glb', bounds: { min: [-13, 0, -13], max: [13, 30, 13] }, triangles: 12 };
  const SIGN = { id: 'sign', file: 'sign.glb', bounds: { min: [-1, 0, -0.1], max: [1, 1, 0.1] }, triangles: 12 };
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
  bodyMat.name = 'body';
  bodyMat.map = new THREE.Texture();
  const faceMat = new THREE.MeshStandardMaterial();
  faceMat.name = 'face';
  faceMat.map = new THREE.Texture();
  const towerGeo = boxGeo(26, 30, 26, 0);
  const h = await makeStreamer(ROCKS, {
    defs: [TOWER, SIGN],
    models: { tower: loadedOf(TOWER, [{ geometry: towerGeo, cell: -1, material: bodyMat }]), sign: loadedOf(SIGN, [{ geometry: boxGeo(2, 1, 0.2, 0), cell: -1, material: faceMat }]) },
  });
  const looks = new RowMaterials({ forget: () => {} });
  h.s.looks = looks;
  // 3 km off: no tier near the eye builds it or loads the sign, so only the landmark index can.
  await h.stream.standPermanent({ key: 'place/tower', model: 'tower', x: 500, y: 0, z: 3000, q: [0, 0, 0, 1], inside: false, solid: true, mats: [{ of: 'body', map: 'tatooine:sign/face' }] } as never, h.s.pack);
  await h.settle({ x: 0, z: 0 }, 20);
  ok(h.s.pack.loaded('sign') === null, 'the sign (the donor) is loaded by nothing near the eye');
  const lm = new LandmarkIndex(h.stream as never);
  await lm.build();
  await frame(h, lm as never, 0, 0, 3328, 0.3);
  const tower = landmarkMeshes(h).find((m) => m.geometry === towerGeo);
  const worn = tower?.material as THREE.MeshStandardMaterial | undefined;
  ok(!!worn && worn !== bodyMat && looks.isCopy(worn) && worn.map === faceMat.map && worn.color.equals(bodyMat.color), "the far copy wears the look's copy with the donor's picture, not the piece's own");
  ok(!looks.notes.some((n) => /not loaded/.test(n)), `and nothing is noted as a donor not loaded (${looks.notes.join('; ') || 'none'})`);
  ok(drawnAt(h, 500, 3000) === 1, 'drawn 3 km off');
  lm.dispose();
  reset();
}

// The eye standing still: a tier shown or let go hands its copy over on that same frame (the streamer's counter, never the
// sweep's clocks), and a tier whose programs are still being built holds nothing (its meshes are hidden until then).
{
  reset();
  LANDMARK_TUNE.on = true;
  const h = await makeStreamer(ROCKS);
  const lm = new LandmarkIndex(h.stream as never);
  await h.settle({ x: 0, z: 0 }, 20);
  await lm.build();
  await frame(h, lm as never, 0, 0, 3328, 0.3);
  ok(drawnAt(h, 0, 3000) === 1 && !h.stream.holdsFiner(h.s.objects[1]), 'standing still, the far rock is the index\'s');
  const gate = gatePrepare(h.stream);
  gate.arm();
  h.stream.setReach(2);
  await frame(h, lm as never, 0, 0, 3328, 0.01);
  await frame(h, lm as never, 0, 0, 3328, 0.01);
  ok(gate.held && !h.stream.holdsFiner(h.s.objects[1]) && drawnAt(h, 0, 3000) === 1, "the Object reach doubled: its tier loads, its programs held, and the index keeps drawing it (a tier not yet shown holds nothing)");
  gate.open();
  await frame(h, lm as never, 0, 0, 3328, 0.01);
  ok(h.stream.holdsFiner(h.s.objects[1]) && drawnAt(h, 0, 3000) === 1, 'shown, its tier holds it and the index lets go on that very frame, the eye still and the sweep\'s clock not due');
  h.stream.setReach(1);
  await frame(h, lm as never, 0, 0, 3328, 0.01);
  ok(!h.stream.holdsFiner(h.s.objects[1]) && drawnAt(h, 0, 3000) === 1, 'the reach put back, its tier let go, and the index takes it up on that very frame');
  lm.dispose();
  reset();
}

// Its programs: a group stays hidden until the streamer's prepare (the world's queue, outright behind a screen) answers.
{
  reset();
  LANDMARK_TUNE.on = true;
  const h = await makeStreamer(ROCKS);
  await h.settle({ x: 0, z: 0 }, 20);
  const gate = gatePrepare(h.stream);
  gate.arm();
  const lm = new LandmarkIndex(h.stream as never);
  const built = lm.build();
  await new Promise((r) => setTimeout(r, 0));
  await frame(h, lm as never, 0, 0, 3328, 0.3);
  ok(gate.held && lm.busy && drawnAt(h, 0, 3000) === 0 && landmarkMeshes(h).every((m) => !m.visible), 'while its programs are being built nothing of it is drawn');
  gate.open();
  await built;
  await frame(h, lm as never, 0, 0, 3328, 0.3);
  ok(!lm.busy && drawnAt(h, 0, 3000) === 1, 'and once they are, it is');
  lm.dispose();
  reset();
}

// The lowest level a model is drawn at: its last carried level that can ever be drawn, a portal building's exterior alone.
{
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial();
  const p = (cell = -1) => ({ geometry: geo, material: mat, cell });
  const levels = [
    { near: 0, far: 100, level: 0, primitives: [p(), p()] },
    { near: 100, far: 400, level: 1, primitives: [p()] },
    { near: 400, far: 1e9, level: 2, primitives: [p(), p(), p()] },
  ];
  const model = { def: { id: 'm', bounds: { min: [0, 0, 0], max: [1, 1, 1] } }, primitives: levels[0].primitives, levels, portals: [] } as never;
  ok(lowestPieces(model).length === 3, 'a model with levels: its lowest');
  const clash = { def: { id: 'm' }, primitives: [], portals: [], levels: [{ near: 0, far: 1, level: 0, primitives: [p()] }, { near: 300, far: 1, level: 1, primitives: [p(), p()] }, { near: 0, far: 1, level: 2, primitives: [p(), p(), p()] }] } as never;
  ok(lowestPieces(clash).length === 2, 'a last level whose switch is at the eye is never drawn (`drawnLevels`): the lowest the pick ever draws is taken');
  const building = { def: { id: 'b' }, primitives: [p(0), p(1), p(2)], portals: [{}], levels: null } as never;
  ok(lowestPieces(building).length === 1, "a portal building with no levels: its shell alone, never its rooms");
}

// The world's hand-overs, which only the game makes (node cannot load `world.ts` or `main.ts`): pinned as text.
{
  const world = readFileSync(join(REPO, 'src/world/world.ts'), 'utf8').replace(/\r\n/g, '\n');
  const main = readFileSync(join(REPO, 'src/main.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(/this\.sweepDetail\(camPos, dt\);\n\s*perf\.end\(SEC\.levels\);\n[^\n]*\n[^\n]*\n\s*if \(this\.landmarks\) this\.stepLandmarks\(this\.landmarks, camPos, dt\);/.test(world), "the index steps right after the detail sweep, which is after the streamer's update (a tier shown or let go hands over that frame)");
  ok(/if \(this\.horizonFollow\.on && f\) a\.reach = f\.rules\.inForce;\n\s*else a\.reach = \(this\.farRadius \+ 0\.5\) \* FAR_TILE;/.test(world), "the reach in force is the rings' while they drew, else the far tiles' (`farTilesReach` written out)");
  const disposes = world.match(/this\.layoutStream\?\.dispose\(\);/g)?.length ?? 0;
  const dropped = world.match(/this\.dropLandmarks\(\);\n(\s*\/\/[^\n]*\n)?\s*this\.rowAttach\.clear\(\);\n\s*this\.layoutStream\?\.dispose\(\);/g)?.length ?? 0;
  ok(disposes === 3 && dropped === 3, `the landmarks are let go before each of the streamer's ${disposes} disposals (${dropped})`);
  ok(/if \(!ls \|\| this\.sceneOnly \|\| this\.planet\?\.space \|\| this\.planet\?\.id === 'gallery' \|\| this\.planet\?\.instances\)/.test(world), 'built on a ground world only (not space, the gallery or the copies)');
  ok(/this\.landmarks = new LandmarkIndex<PlacedObject>\(ls\);\n\s*\}\n\s*return this\.landmarks\.build\(\);/.test(world), "the world's collection (an arrival's, a curtain's) takes the size rule as it stands (`build()`, never `build(false)`)");
  const iBuilt = main.indexOf('const landmarksBuilt = this.world.standLandmarks();');
  const iDress = main.indexOf('await Promise.race([this.dressingBuilt,');
  const iWait = main.indexOf("this.loadingScreen.setWhat('the landmarks');");
  const iSweep = main.indexOf('const compiled = await this.world.compileAllAsync(');
  ok(iDress > 0 && iBuilt > iDress && iWait > iBuilt && iSweep > iWait, "the loading screen begins them once the rows are filed and waits for them (bounded) before its sweep, so their programs are the screen's");
  ok(/Math\.min\(LANDMARK_TUNE\.waitMs, timeoutMs - \(performance\.now\(\) - t0\)\)/.test(main), 'bounded by `waitMs` and what is left of the screen');
  // The review round: a moved least half-span (or one the dial moved, with `apply`) is taken behind the far ground's curtain
  // in a world, and from the next arrival elsewhere, never by the index's frame.
  ok(main.includes("else if ((o?.apply === true || (o?.tune !== undefined && 'minSize' in o.tune)) && this.world.landmarks?.pending) said.push(await this.applyLandmarks());"), '`__debug.landmarks` takes a moved least half-span through `applyLandmarks`');
  const iApply = main.indexOf('private async applyLandmarks(): Promise<string> {');
  const applyBody = iApply > 0 ? main.slice(iApply, main.indexOf('\n  }\n', iApply)) : '';
  ok(/if \(!this\.inWorld \|\| this\.traveling\) return [^\n]*next arrival[^\n]*;\n\s*await this\.groundCurtain\('the landmarks', \(\) => this\.world\.standLandmarks\(\)\);/.test(applyBody), 'which collects behind the far ground\'s short curtain in a world, and says the next arrival elsewhere');
}

console.log(`\nlandmarks: ${checks} checks passed`);
process.exit(0);
