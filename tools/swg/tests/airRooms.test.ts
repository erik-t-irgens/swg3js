// A compound's rooms for the moving air (the volumetrics' first wave, review): the real `LayoutStreamer.forEachSolidBox`
// over a world made up on the spot (`streamHarness.ts`). A box wider than `obstacles.widest` is no wall -- Mos Eisley's
// starport is one model box 160 m across round its own open courtyard -- so the obstacles leave it out; but its halls
// are rooms, and the volume must keep its dust out of a room it sees through a door from outside (the design's risk 8).
// Held here: a compound wider than the line the obstacles pass is visited with each of its rooms after it, flagged a
// room, each where the building's own matrix puts its middle (turned with it), its top the room's over the building's
// origin; its outside (cell 0) and a room wholly under the ground are not; a building no wider than the line, and any
// building when no line is passed, is visited alone, as it always was; and the obstacles keep those rooms for the
// volume's channel alone.
//
// Plain type stripping over the real streamer (Rapier loads under node).
import assert from 'node:assert/strict';
import { makeStreamer, THREE, type Def, type SnapshotObject } from './streamHarness.ts';
import type { SolidBox } from '../../../src/world/layoutStream.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import { AirObstacles } from '../../../src/world/volumetrics/airObstacles.ts';
import { newWindow, placeWindow } from '../../../src/world/volumetrics/fluidWindow.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A compound 160 m by 150 m and 48 m tall round its own courtyard: its outside, two halls, and a cellar under the ground. */
const COMPOUND = {
  id: 'compound',
  file: 'compound.glb',
  bounds: { min: [-80, 0, -75], max: [80, 48, 75] },
  triangles: 24,
  cells: [
    { index: 0, name: 'r0', bounds: { min: [-80, 0, -75], max: [80, 48, 75] } },
    { index: 1, name: 'hall', bounds: { min: [-70, 0, 50], max: [-30, 12, 70] } },
    // Written with the larger corner first, as a pack converted before that was read right carries it.
    { index: 2, name: 'lobby', bounds: { min: [60, 9, -10], max: [40, 0, 10] } },
    { index: 3, name: 'cellar', bounds: { min: [-5, -20, -5], max: [5, -2, 5] } },
  ],
};
/** A house 20 m across with one room: no compound, a wall as it always was. */
const HOUSE_WITH_ROOM = {
  id: 'cottage',
  file: 'cottage.glb',
  bounds: { min: [-10, 0, -10], max: [10, 8, 10] },
  triangles: 24,
  cells: [
    { index: 0, name: 'r0', bounds: { min: [-10, 0, -10], max: [10, 8, 10] } },
    { index: 1, name: 'r1', bounds: { min: [-9, 0, -9], max: [9, 7.5, 9] } },
  ],
};

// The compound at the game's (300, 0, 200) turned a quarter about the up axis (the snapshot's (w, x, y, z), x mirrored
// about a centre of nought), and the cottage at (360, 0, 260) unturned.
const s45 = Math.SQRT1_2;
const objects: SnapshotObject[] = [
  { template: 'object/compound', model: 'compound', x: -300, y: 0, z: 200, q: [s45, 0, s45, 0], radius: 120 },
  { template: 'object/cottage', model: 'cottage', x: -360, y: 0, z: 260, q: [1, 0, 0, 0], radius: 15 },
];
const h = await makeStreamer(objects, { defs: [COMPOUND as unknown as Def, HOUSE_WITH_ROOM as unknown as Def] });

const seen: SolidBox[] = [];
const rec: SolidBox = { x: 0, z: 0, hx: 0, hz: 0, cos: 1, sin: 0, top: 0, room: false };
const visit = (b: SolidBox): boolean => {
  seen.push({ ...b });
  return true;
};
h.stream.forEachSolidBox(100, 0, 500, 400, rec, visit, AIR_TUNE.obstacles.widest);
const own = seen.filter((b) => !b.room);
const rooms = seen.filter((b) => b.room);
ok(own.length === 2 && rooms.length === 2, `the walk visits both buildings and the compound's two rooms above the ground (${own.length} own boxes, ${rooms.length} rooms), never its outside or its cellar`);

// Where the building's own matrix puts each room's middle: the frame `roomOf.ts` reads the rooms in.
const p = h.s.regions && [...h.s.regions.values()].flatMap((r: { objects: { model: string }[][] }) => r.objects.flat()).find((o: { model: string }) => o.model === 'compound');
const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), p.q, new THREE.Vector3(1, 1, 1));
const middle = (min: number[], max: number[]): THREE.Vector3 => new THREE.Vector3((min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2).applyMatrix4(m);
const hall = middle(COMPOUND.cells[1].bounds.min, COMPOUND.cells[1].bounds.max);
const lobby = middle(COMPOUND.cells[2].bounds.min, COMPOUND.cells[2].bounds.max);
const at = (v: THREE.Vector3): SolidBox | undefined => rooms.find((b) => Math.abs(b.x - v.x) < 1e-6 && Math.abs(b.z - v.z) < 1e-6);
const rh = at(hall);
const rl = at(lobby);
ok(!!rh && !!rl, `each room stands where the building's own matrix puts its middle, turned with it (the hall at ${hall.x.toFixed(1)}, ${hall.z.toFixed(1)})`);
ok(!!rh && rh.hx === 20 && rh.hz === 10 && rh.top === 12, 'the hall: its half sizes along its own axes, and its top over the origin');
ok(!!rl && rl.hx === 10 && rl.hz === 10 && rl.top === 9, 'the lobby, whose corners the pack wrote the larger first, taken componentwise');
const compound = own.find((b) => b.hx === 80);
ok(!!compound && !!rh && rh.cos === compound.cos && rh.sin === compound.sin && Math.abs(compound.cos) < 1e-9, "and turned as the compound's own box is: a quarter round");
const firstRoom = seen.findIndex((b) => b.room);
const compoundAt = seen.findIndex((b) => !b.room && b.hx === 80);
ok(compoundAt >= 0 && firstRoom === compoundAt + 1 && seen[compoundAt + 2]?.room === true, 'the rooms come straight after the compound they belong to');

seen.length = 0;
h.stream.forEachSolidBox(100, 0, 500, 400, rec, visit);
ok(seen.length === 2 && seen.every((b) => !b.room), 'asked with no line, every building is visited alone, as it always was');

// The obstacles over the real walk: the compound left out, its rooms kept for the volume alone, the cottage a wall.
{
  const w = newWindow();
  placeWindow(w, 300, 200, AIR_TUNE.window.size, 128, AIR_TUNE.window.jump);
  const obs = new AirObstacles({ value: new THREE.Vector4() });
  obs.gather(h.stream, w);
  const t = obs.mesh.geometry.getAttribute('aTurn').array as Float32Array;
  let walls = 0;
  let masks = 0;
  for (let i = 0; i < obs.count; i++) (t[i * 4 + 3] === 1 ? walls++ : masks++);
  ok(obs.tooWide === 1 && obs.rooms === 2 && walls === 1 && masks === 2, `the obstacles leave the compound out (${obs.tooWide}), keep its ${obs.rooms} rooms for the volume's channel alone, and the cottage as a wall`);
  obs.dispose();
}

console.log(`\n${checks} checks passed`);
