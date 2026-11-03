// The rooms' lights as the game itself puts them in force (Map-maker II's wave of the rooms' lights), held in node by running the
// game's own code -- never a copy of it in the test:
//
//   1. The world's own lines (`updateInteriorLights`, `copyKeyOf`, `setRoomLightRows`, `askLights`, `attachedLightsIn`,
//      `stepRoomLights`, `readWalk`, `setRoomLightPool`, `roomLightLive`, read out of `world.ts` as text and run over a stand-in
//      world holding a real pool of real lights): a building of one of the world's own objects lit by its content key's copy
//      rows, a permanent row's by `place/<id>`, a house put down in play by its model's rows alone, a building of another model
//      by none of them; nothing planned again on a frame with nothing moved; the lit building handed to the rooms' shadow pass
//      while a lamp casts; a light hung on a row lit in its own building's room alone and following its row; the frame's one
//      read of the shared clock; a shared file landing with no world file; the pool's lights on the rooms' layer.
//   2. The rooms' own shadow pass, run in a real `PortalRenderer` on a recording stand-in renderer: the lit building's rooms
//      shown in it and never in the sun's, the lit casting slots' maps asked for and the sun's cascades held out of it and put
//      back, run whatever the sun's pass did (a storm, inside with no exit in view), and every casting slot drawn into by the
//      warm-up's shadow-only draw.
//   3. The effects' read of the pool (`fillRoomLightFx`) and the occlusion's uniforms (`fillRoomPoolUniforms`), from a pool lit
//      with a casting point, a plain spot and a casting spot.
//   4. A light hung on a row: the row reader keeps it (its place and turn, no size), `RowAttachments.lightList` lists it as its
//      row stands and takes it away as its row goes, telling the world each time.
//   5. The hand-overs only the page makes, pinned as text.
//
// Run: node tools/swg/tests/roomLightsWorld.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';
import { DEFAULT_POOL, ROOM_LIGHT_TUNE, planRoomLights, type RoomLightCell } from '../../../src/world/roomLights.ts';
import { LightClock, RoomLightPool, roomPoolShape } from '../../../src/world/roomLightPool.ts';
import { NO_LIGHT_EDITS, RoomLightEdits } from '../../../src/world/roomLightEdits.ts';
import { readLightRow, type LightRow } from '../../../src/world/editFiles/lightsFile.ts';
import { INTERIOR_LAYER, PortalRenderer } from '../../../src/world/portalRender.ts';
import { fillRoomLightFx } from '../../../src/world/roomLightFx.ts';
import { createFxLights, resetFxLights } from '../../../src/core/fx/lights.ts';
import { fillRoomPoolUniforms } from '../../../src/core/fx/roomPoolUniforms.ts';
import { readAttachments, type PlacementRow } from '../../../src/story/placements.ts';
import { RowAttachments } from '../../../src/world/rowAttach.ts';
import type { Portal } from '../../../src/world/assetPack.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const lines = (rel: string): string[] => readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/);
const text = (rel: string): string => lines(rel).join('\n');

/** A method of a class read out of a file as text: its declaration line to the brace closing it at two spaces. */
function method(src: string[], name: string): string {
  const at = src.findIndex((l) => new RegExp(`^  (?:private |static |async |readonly )*${name}\\(`).test(l));
  assert.ok(at >= 0, `found ${name}`);
  for (let i = at + 1; i < src.length; i++) if (src[i] === '  }') return src.slice(at, i + 1).join('\n');
  throw new Error(`${name} has no end`);
}

// ---- 1. The world's own lines, run. ----

const WORLD = lines('src/world/world.ts');
const NAMES = ['updateInteriorLights', 'stepRoomLights', 'readWalk', 'copyKeyOf', 'setRoomLightRows', 'askLights', 'roomLightsMoved', 'attachedLightsIn', 'roomLightLive', 'setRoomLightPool'];
const source = `class WorldLines {\n${NAMES.map((n) => method(WORLD, n)).join('\n\n')}\n}\n`;
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
interface Clock {
  calls: number;
  t: number;
  walkSecondsIn(out: { t: number }): void;
}
const clock: Clock = {
  calls: 0,
  t: 42.5,
  walkSecondsIn(out) {
    this.calls++;
    out.t = this.t;
  },
};
const WorldLines = new Function('ROOM_LIGHT_TUNE', 'planRoomLights', 'RoomLightEdits', 'NO_LIGHT_EDITS', 'sharedClock', 'THREE', 'INTERIOR_LAYER', `${js}\nreturn WorldLines;`)(ROOM_LIGHT_TUNE, planRoomLights, RoomLightEdits, NO_LIGHT_EDITS, clock, THREE, INTERIOR_LAYER) as { prototype: object };
ok(NAMES.every((n) => typeof (WorldLines.prototype as Record<string, unknown>)[n] === 'function'), `the world's own ${NAMES.length} methods of the rooms' lights are read out of world.ts and run (${NAMES.join(', ')})`);

const lamp = (x: number, y: number, z: number, col: [number, number, number] = [1, 0.9, 0.7]) => ({ type: 2, color: col, position: [x, y, z], direction: [0, 0, 1], attenuation: [1, 0.2, 0.01] });
const CELLS: (RoomLightCell & { name: string })[] = [
  { index: 0, name: 'r0', lights: [] },
  { index: 1, name: 'hall', portals: [{ target: 2 }], lights: [{ type: 0, color: [0.1, 0.1, 0.1], position: [0, 0, 0], direction: [0, 0, 1], attenuation: [1, 0, 0] }, { type: 1, color: [1, 1, 1], position: [0, 6, 0], direction: [0, -1, 0], attenuation: [1, 0, 0] }, lamp(1, 2.5, 1), lamp(-2, 2.5, 3), lamp(3, 2.5, -1, [0.4, 0.5, 1])] } as RoomLightCell & { name: string },
  { index: 2, name: 'back', portals: [{ target: 1 }], lights: [lamp(0, 2, -6)] } as RoomLightCell & { name: string },
];
const M = new THREE.Matrix4().compose(new THREE.Vector3(40, 0, -50), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7), new THREE.Vector3(1, 1, 1));
const KEY_W = 'o:object/building/x/shared_house.iff@40,0,-50';
interface B {
  model: { def: { id: string; cells: typeof CELLS } };
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  object: { template: string; row?: number } | null;
  template: string;
}
const building = (object: B['object'], model = 'ours_house'): B => ({ model: { def: { id: model, cells: CELLS } }, matrix: M, inverse: M.clone().invert(), object, template: object?.template ?? 'home:1' });
const W = building({ template: 'object/building/x/shared_house.iff', row: 5 });
const P = building({ template: 'place/house-1' });
const N = building(null);
const O = building({ template: 'object/building/y/shared_other.iff', row: 6 }, 'other_house');

const row = (o: Record<string, unknown>): LightRow => {
  const r = readLightRow({ scope: 'world', model: 'ours_house', cell: 1, room: 'hall', ...o }, o.scope === 'all');
  if (typeof r === 'string') throw new Error(`${String(o.id)}: ${r}`);
  return r;
};
const ROWS_WORLD = [
  row({ id: 'c-w', kind: 'edit', scope: 'copy', copy: KEY_W, of: 2, scale: 0.5 }),
  row({ id: 'c-p', kind: 'edit', scope: 'copy', copy: 'place/house-1', of: 3, off: true }),
  row({ id: 'e-w', kind: 'edit', of: 4, color: [0, 1, 0] }),
  row({ id: 'candle-1', kind: 'light', type: 'point', color: [1, 0.6, 0.3], brightness: 0.3, reach: 5, pos: [0.5, 1, 0.5], flicker: { shape: 'candle', rate: 5, depth: 0.4 } }),
];
const ROWS_ALL = [row({ id: 'all-lamp-1', kind: 'light', scope: 'all', type: 'point', color: [1, 1, 1], brightness: 0.7, reach: 9, pos: [1, 2, 1] })];

interface Lights {
  points: THREE.PointLight[];
  parallel: THREE.DirectionalLight;
  ambient: THREE.AmbientLight;
}
const makeLights = (): Lights => ({ points: Array.from({ length: 8 }, () => new THREE.PointLight(0xffffff, 0, 1, 2)), parallel: new THREE.DirectionalLight(0xffffff, 0), ambient: new THREE.AmbientLight(0xffffff, 0) });
/** Every value of the lights a room is lit by (a slot at nought keeps whatever the last room left in it, so it reads as nought alone). */
const trace = (L: Lights): number[] => {
  const out: number[] = [];
  for (const l of L.points) {
    if (l.intensity === 0) out.push(0);
    else out.push(l.intensity, l.color.r, l.color.g, l.color.b, l.distance, l.decay, l.position.x, l.position.y, l.position.z);
  }
  const p = L.parallel;
  out.push(p.intensity, p.color.r, p.color.g, p.color.b, p.position.x, p.position.y, p.position.z, L.ambient.intensity, L.ambient.color.r, L.ambient.color.g, L.ambient.color.b);
  return out;
};
const same = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
/** What a building is lit by under the given rows and copy key, on fresh lights (and its pool, for a later step). */
const expected = (b: B, copy: string | null, world: LightRow[], all: LightRow[]): { L: Lights; pool: RoomLightPool } => {
  const L = makeLights();
  const pool = new RoomLightPool(L.points, L.parallel, L.ambient);
  const e = world.length || all.length ? new RoomLightEdits(world, all).forRoom(copy, b.model.def.id, CELLS, []) : undefined;
  pool.apply(planRoomLights(CELLS, 1, ROOM_LIGHT_TUNE.ambientFloor, DEFAULT_POOL, e)!, b.matrix, new Array(8).fill(-1));
  // The world steps a plan that flickers at once, on the frame's read of the clock.
  pool.step(clock.t);
  return { L, pool };
};

type Self = Record<string, unknown> & {
  updateInteriorLights(): void;
  stepRoomLights(): void;
  copyKeyOf(b: B): string | null;
  setRoomLightRows(world: readonly LightRow[], all: readonly LightRow[]): void;
  askLights(pack: string): void;
  roomLightLive(l: { key: string; x: number; y: number; z: number; dx: number; dy: number; dz: number }): void;
  setRoomLightPool(shape: ReturnType<typeof roomPoolShape>): boolean;
};
const attached: { key: string; rowKey: string; index: number; world: THREE.Matrix4; spec: object; inside: boolean }[] = [];
const L0 = makeLights();
const w = Object.create(WorldLines.prototype) as Self;
const portalsStub = { hintedLights: { building: null as unknown }, roomShadowBuilding: null as unknown };
Object.assign(w, {
  lightHint: { state: null },
  cellState: null,
  layoutStream: {
    buildings: new Set(),
    // The streamer's room rule stood in for: a point west of x = 100 is in W's hall, east of it in O's.
    cameraRoomAt(ask: THREE.Vector3, answer: { building: unknown; cell: number }) {
      answer.building = ask.x < 100 ? W : O;
      answer.cell = 1;
      return answer;
    },
  },
  portals: portalsStub,
  interiorLightsFor: null,
  roomTuneSeen: ROOM_LIGHT_TUNE.version,
  roomPlanStale: false,
  roomPool: new RoomLightPool(L0.points, L0.parallel, L0.ambient),
  roomPlan: null,
  roomPlanStaleRows: [],
  roomPlanVersion: 0,
  fxLampCells: new Array(8).fill(-1),
  roomLightEdits: NO_LIGHT_EDITS,
  rowAttach: { lightList: () => attached, matrixOf: (k: string, i: number) => attached.find((a) => a.rowKey === k && a.index === i)?.world ?? null },
  objectKeyOf: (r: number) => (r === 5 ? KEY_W : r === 6 ? 'o:object/building/y/shared_other.iff@200,0,0' : ''),
  frameWalk: new LightClock(),
  walkTick: 1,
  walkReadAt: -1,
  scene: new THREE.Scene(),
  lightsSource: null,
  lightsAsk: 0,
  lightsFileInfo: { world: 'none', all: 'none' },
  sceneOnly: false,
  generation: 1,
  kindOfWorld: () => 'ground',
});
const enter = (b: B): void => {
  w.cellState = { building: b, cell: 1 };
  w.updateInteriorLights();
};

{
  ok(w.copyKeyOf(W) === KEY_W && w.copyKeyOf(P) === 'place/house-1' && w.copyKeyOf(N) === null, "a copy is named by the world's own object's content key, a permanent row's streamer key, or nothing for a house put down in play");
  w.setRoomLightRows(ROWS_WORLD, ROWS_ALL);
  for (const [name, b, copy] of [['one of the world\'s own objects', W, KEY_W], ['a permanent row of the owner\'s', P, 'place/house-1'], ['a house put down in play', N, null]] as const) {
    enter(b);
    const want = expected(b, copy, ROWS_WORLD, ROWS_ALL).L;
    const none = expected(b, null, [], []).L;
    ok(same(trace(L0), trace(want)) && !same(trace(L0), trace(none)), `${name}: lit by the rows reaching its copy (${copy ?? 'no copy key: its model\'s rows alone'}), every value as the plan with those edits puts them`);
  }
  enter(W);
  ok(!same(trace(L0), trace(expected(W, null, ROWS_WORLD, ROWS_ALL).L)), "the copy's own row is what lights it so: without its key the copy row of it would not reach it");
  enter(O);
  ok(same(trace(L0), trace(expected(O, null, [], []).L)), 'a building of another model whose rooms share every index and name is lit as with no lights file at all');
  // Nothing moved: nothing planned again; the rows put in force again: planned again on the next frame.
  enter(W);
  const v = w.roomPlanVersion as number;
  w.updateInteriorLights();
  w.updateInteriorLights();
  ok(w.roomPlanVersion === v, 'a frame with the room and the files unmoved plans nothing again');
  w.setRoomLightRows(ROWS_WORLD, ROWS_ALL);
  w.updateInteriorLights();
  ok(w.roomPlanVersion === v + 1, 'rows put in force plan the lit room again, once');
  // The frame's one read of the shared clock, and the flicker on it: a new frame, then the pool stepped twice in it.
  (w as { walkTick: number }).walkTick++;
  clock.calls = 0;
  w.stepRoomLights();
  w.stepRoomLights();
  ok(clock.calls === 1 && (w.roomPool as RoomLightPool).clock.t === 42.5, 'the shared clock is read once a frame however often the pool steps, and the pool flickers on that read');
  (w as { walkTick: number }).walkTick++;
  w.stepRoomLights();
  ok(clock.calls === 2, 'and read again in the next frame');
  const want = expected(W, KEY_W, ROWS_WORLD, ROWS_ALL);
  want.pool.step(42.5);
  ok(same(trace(L0), trace(want.L)), 'the candle flickered as the plan and its seed say at that moment');
}

// The pool's shape, its lights on the rooms' layer; the lit building handed to the rooms' shadow pass while a lamp casts.
{
  const before = (w.scene as THREE.Scene).children.length;
  ok(w.setRoomLightPool(roomPoolShape(2, 1)) && (w.scene as THREE.Scene).children.length > before, "a shape with spots and a casting slot adds its lights to the world's scene");
  const added = (w.scene as THREE.Scene).children.filter((o) => (o as THREE.Light).isLight) as THREE.Light[];
  ok(added.length === 3 && added.every((l) => l.layers.mask === 1 << INTERIOR_LAYER), `every light the shape adds is on the rooms' layer alone (${added.map((l) => l.layers.mask).join(', ')})`);
  enter(W);
  ok(portalsStub.roomShadowBuilding === null, 'with no light asking for a shadow no building is handed to the rooms\' shadow pass');
  const asks = row({ id: 'lamp-s', kind: 'light', type: 'point', color: [1, 1, 1], brightness: 1, reach: 8, pos: [0, 3, 0], shadow: true });
  w.setRoomLightRows([...ROWS_WORLD, asks], ROWS_ALL);
  w.updateInteriorLights();
  ok(portalsStub.roomShadowBuilding === W && (w.roomPool as RoomLightPool).litN === 1, "a lamp casting: the lit building is handed to the rooms' shadow pass, the lamp's slot listed for it");
  w.setRoomLightRows(ROWS_WORLD, ROWS_ALL);
  w.updateInteriorLights();
  ok(portalsStub.roomShadowBuilding === null && (w.roomPool as RoomLightPool).litN === 0, 'and taken back once none casts');
  w.setRoomLightPool(DEFAULT_POOL);
  ok((w.scene as THREE.Scene).children.length === before, 'the default shape again takes every light it added away');
}

// A light hung on a row: lit in its own building's room alone, after the file's own, and following its row.
{
  const mA = new THREE.Matrix4().makeTranslation(42, 2, -49);
  const mB = new THREE.Matrix4().makeTranslation(210, 2, 0);
  const spec = { type: 'point', color: [1, 1, 1], brightness: 0.5, reach: 6 };
  attached.push({ key: 'att:place/lamp-1#0', rowKey: 'place/lamp-1', index: 0, world: mA, spec, inside: true }, { key: 'att:place/lamp-2#0', rowKey: 'place/lamp-2', index: 0, world: mB, spec, inside: true });
  (w as { roomLightsMoved(): void }).roomLightsMoved();
  enter(W);
  const plan = w.roomPlan as ReturnType<typeof planRoomLights>;
  ok(!!plan && plan.points.some((p) => p.key === 'att:place/lamp-1#0') && !plan.points.some((p) => p.key === 'att:place/lamp-2#0'), "a light hung on a row standing in this building's room is lit, and one standing in another building's room is not");
  const slot = L0.points.find((l) => l.intensity > 0 && Math.abs(l.position.x - 42) < 1e-6 && Math.abs(l.position.z + 49) < 1e-6);
  ok(!!slot, 'it stands where its row holds it');
  mA.makeTranslation(45, 2.5, -47);
  (w as { walkTick: number }).walkTick++;
  w.stepRoomLights();
  ok(!!slot && Math.abs(slot.position.x - 45) < 1e-6 && Math.abs(slot.position.y - 2.5) < 1e-6 && Math.abs(slot.position.z + 47) < 1e-6, 'its row moved (the editor\'s hand on the row), it follows on the next frame');
  attached.length = 0;
  (w as { roomLightsMoved(): void }).roomLightsMoved();
  w.updateInteriorLights();
}

// The editor's hand: a light carried where the hand has it, the record handed whole, and let go planned again.
{
  enter(W);
  const v = w.roomPlanVersion as number;
  w.roomLightLive({ key: 'candle-1', x: 1, y: 2, z: 3, dx: 0, dy: -1, dz: 0 });
  (w as { walkTick: number }).walkTick++;
  w.stepRoomLights();
  const at = new THREE.Vector3(1, 2, 3).applyMatrix4(M);
  ok(L0.points.some((l) => l.position.distanceTo(at) < 1e-9), 'the light the hand moves stands where the hand has it');
  w.roomLightLive({ key: '', x: 0, y: 0, z: 0, dx: 0, dy: -1, dz: 0 });
  w.updateInteriorLights();
  ok(w.roomPlanVersion === v + 1 && !L0.points.some((l) => l.position.distanceTo(at) < 1e-9), 'let go, the lit room is planned again and the light stands where its row does');
}

// A world's ask: a shared file landing with no world file of its own is put in force.
{
  w.lightsSource = async () => ({ world: [], all: ROWS_ALL, info: { world: 'none', all: '1 rows' } });
  w.askLights('tatooine');
  await new Promise((r) => setTimeout(r, 0));
  const e = w.roomLightEdits as RoomLightEdits;
  ok(e.all.length === 1 && e.world.length === 0 && (w.lightsFileInfo as { all: string }).all === '1 rows', 'the shared file alone, with no world file: put in force all the same');
  w.lightsSource = async () => ({ world: ROWS_WORLD, all: [], info: { world: '4 rows', all: 'none' } });
  w.askLights('tatooine');
  await new Promise((r) => setTimeout(r, 0));
  ok((w.roomLightEdits as RoomLightEdits).world.length === 4 && (w.roomLightEdits as RoomLightEdits).all.length === 0, "a world's own file in the world's place, the shared one's empty");
}

// ---- 2. The rooms' own shadow pass, in a real portal renderer. ----

interface Snap {
  scene: THREE.Object3D;
  shadow: boolean;
  /** The lights whose map this draw would make (three's own skip: `autoUpdate` or `needsUpdate`). */
  drew: THREE.Light[];
  sunAuto: boolean[];
  interiorShown: boolean;
}
const sun = [0, 1, 2].map(() => {
  const l = new THREE.DirectionalLight(0xffffff, 1);
  l.castShadow = true;
  return l;
});
const quad = (x0: number, x1: number, y0: number, y1: number, z: number) => ({ v: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], i: [0, 1, 2, 0, 2, 3] });
/** Two rooms and, with a door, a way out at z 5, as the portal culling test builds them; its rooms' two meshes. */
const portalBuilding = (withDoor: boolean): Record<string, unknown> & { interior: THREE.Mesh[] } => {
  const def = {
    id: withDoor ? 'lights_two_rooms_door' : 'lights_two_rooms_shut',
    bounds: { min: [-5, 0, -5], max: [5, 3, 5] },
    cells: [
      { index: 0, name: 'r0', bounds: { min: [-5, 0, -5], max: [5, 3, 5] }, portals: withDoor ? [{ geometry: 1, target: 2, passable: true }] : [] },
      { index: 1, name: 'front', bounds: { min: [-5, 0, -5], max: [5, 3, 0] }, portals: [{ geometry: 0, target: 2, passable: true }] },
      { index: 2, name: 'back', bounds: { min: [-5, 0, 0], max: [5, 3, 5] }, portals: [{ geometry: 0, target: 1, passable: true }, ...(withDoor ? [{ geometry: 1, target: 0, passable: true }] : [])] },
    ],
  };
  const polys = withDoor ? [quad(-1, 1, 0, 2.2, 0), quad(-1, 1, 0, 2.2, 5)] : [quad(-1, 1, 0, 2.2, 0)];
  const portals: Portal[] = polys.map((poly) => {
    const verts = poly.v.map((v) => new THREE.Vector3(v[0], v[1], v[2]));
    const normal = new THREE.Vector3().subVectors(verts[1], verts[0]).cross(new THREE.Vector3().subVectors(verts[2], verts[0])).normalize();
    return { verts, indices: poly.i.slice(), normal, d: normal.dot(verts[0]), links: [], passable: true };
  });
  for (const c of def.cells) for (const l of c.portals) portals[l.geometry]?.links.push({ from: c.index, to: l.target });
  const matrix = new THREE.Matrix4();
  const interior = [new THREE.Mesh(new THREE.BoxGeometry()), new THREE.Mesh(new THREE.BoxGeometry())];
  for (const m of interior) m.visible = false;
  return { model: { portals, def }, matrix, inverse: matrix.clone().invert(), x: 0, z: 0, radius: 5, interior, interiorCell: [1, 2] };
};
{
  const snaps: Snap[] = [];
  const L = makeLights();
  const pool = new RoomLightPool(L.points, L.parallel, L.ambient);
  const scene = new THREE.Scene();
  pool.setShape(roomPoolShape(2, 1), scene, INTERIOR_LAYER);
  const allLights = (): THREE.Light[] => [...sun, ...pool.casterList];
  let watch: THREE.Mesh[] = [];
  const stub = {
    autoClear: true,
    info: { render: { calls: 0, triangles: 0 } },
    shadowMap: { enabled: true, autoUpdate: false, needsUpdate: false },
    state: { buffers: { stencil: { setClear: () => undefined } } },
    renderBufferDirect: () => undefined,
    clear: () => undefined,
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(1920, 1080),
    render: (s: THREE.Object3D, camera: THREE.Camera) => {
      const shadow = s === portals.passScenes.shadow;
      const drew = shadow ? allLights().filter((l) => (l as THREE.DirectionalLight).shadow.autoUpdate || (l as THREE.DirectionalLight).shadow.needsUpdate) : [];
      snaps.push({ scene: s, shadow, drew, sunAuto: sun.map((l) => l.shadow.autoUpdate), interiorShown: watch.some((m) => m.visible) });
      // Three draws each such map and clears its `needsUpdate`, and makes its map where it has none.
      for (const l of drew) {
        const sh = (l as THREE.DirectionalLight).shadow;
        sh.needsUpdate = false;
        if (sh.map === null) sh.map = new THREE.WebGLRenderTarget(1, 1);
      }
      void camera;
    },
    compile: () => new Set(),
  };
  const portals = new PortalRenderer(stub as unknown as THREE.WebGLRenderer);
  portals.shadowLights = sun;
  portals.roomShadows = pool;
  const hooks: string[] = [];
  portals.roomShadowHooks = { before: () => hooks.push('before'), after: () => hooks.push('after') };
  const camera = new THREE.PerspectiveCamera(60, 1920 / 1080, 0.05, 9000);
  const look = (x: number, y: number, z: number, tx: number, ty: number, tz: number) => {
    camera.position.set(x, y, z);
    camera.lookAt(tx, ty, tz);
    camera.updateMatrixWorld(true);
  };
  const near = portalBuilding(true);
  watch = near.interior;
  // A plan lit with a lamp casting in its slot (the casting spot unlit), as the world plans the lit room.
  const rows = [row({ id: 'lamp-s', kind: 'light', type: 'point', color: [1, 1, 1], brightness: 1, reach: 8, pos: [0, 2, 0], shadow: true })];
  pool.apply(planRoomLights(CELLS, 1, 0.18, pool.shape, new RoomLightEdits(rows, []).forRoom('place/house-1', 'ours_house', CELLS))!, new THREE.Matrix4(), new Array(8).fill(-1));
  portals.roomShadowBuilding = near as never;
  const frame = (view: unknown, buildings: unknown[]): Snap[] => {
    snaps.length = 0;
    hooks.length = 0;
    for (const l of sun) {
      l.shadow.autoUpdate = true;
      l.shadow.needsUpdate = false;
    }
    portals.render(scene, camera, view as never, buildings as never);
    return snaps.filter((s) => s.shadow);
  };
  // The first frame makes every casting slot's map (its `firstMaps`); the second is a frame like any other.
  look(0, 1.6, 20, 0, 1.6, 0);
  const first = frame(null, [near]);
  ok(first.some((s) => pool.casterList.every((c) => s.drew.includes(c))), "a shape just made: every casting slot's map is made at the first shadow draw (a sampler with no map throws the draw away)");
  const two = frame(null, [near]);
  ok(two.length === 2, `outside, a frame draws the sun's shadow pass and the rooms' own (${two.length} shadow draws)`);
  const [sunPass, roomPass] = two;
  ok(sunPass.drew.length === 3 && sun.every((l) => sunPass.drew.includes(l)) && !sunPass.interiorShown, "the sun's pass draws the sun's three cascades and nothing of the lit building's rooms (the street seen through a door reads those maps)");
  ok(roomPass.drew.length === 1 && roomPass.drew[0] === pool.pointShadows[0] && roomPass.interiorShown && roomPass.sunAuto.every((a) => !a), "the rooms' own pass draws the lit casting lamp's map alone, with the building's rooms shown and the sun's cascades held out of it");
  ok(sun.every((l) => l.shadow.autoUpdate === true) && near.interior.every((m) => !m.visible) && hooks.join() === 'before,after', "and puts the cascades back as it found them, hides the rooms again, and runs the batches' hooks round it");
  // A storm that has put the sun's shadows out: the rooms' pass runs all the same.
  portals.shadowsWanted = false;
  const storm = frame(null, [near]);
  portals.shadowsWanted = true;
  ok(storm.length === 1 && storm[0].drew.length === 1 && storm[0].drew[0] === pool.pointShadows[0], "in a storm that has put the sun's shadows out, the rooms' own pass still draws the lamp's map");
  // Inside a building with no exit in view: no world and no sun's pass, the rooms' own pass all the same.
  const shut = portalBuilding(false);
  watch = shut.interior;
  portals.roomShadowBuilding = shut as never;
  look(0, 1.6, -3, 0, 1.6, -4);
  portals.cameraCell({ building: shut, cell: 1 } as never, camera.position, camera.position, [shut] as never);
  portals.computeVisibility(camera, [shut] as never);
  const inside = frame(shut, [shut]);
  ok(portals.worldSkipped && inside.length === 1 && inside[0].drew[0] === pool.pointShadows[0] && inside[0].interiorShown, `inside with no exit in view (the world skipped: ${portals.worldSkipped}), the rooms' own pass still draws the lamp's map with the rooms shown`);
  // Nothing lit casts: no rooms' pass at all.
  pool.clear();
  portals.roomShadowBuilding = null;
  const quiet = frame(null, [near]);
  ok(quiet.length === 1 && quiet[0].drew.every((l) => sun.includes(l as THREE.DirectionalLight)), 'with nothing casting, the sun\'s pass alone');
  // The warm-up's shadow-only draw asks every casting slot's map, lit or not, so the stand-ins build a point slot's own depth
  // programs (three's distance material's) behind the screen.
  snaps.length = 0;
  portals.drawShadowsOnly(scene);
  ok(snaps.length === 1 && pool.casterList.every((c) => snaps[0].drew.includes(c)) && sun.every((l) => snaps[0].drew.includes(l)), "the warm-up's shadow-only draw draws into every cascade and every casting slot of the pool, lit or not");
}

// ---- 3. The effects' read of the pool, and the occlusion's uniforms. ----

{
  const L = makeLights();
  const pool = new RoomLightPool(L.points, L.parallel, L.ambient);
  const scene = new THREE.Scene();
  pool.setShape(roomPoolShape(2, 1), scene, INTERIOR_LAYER);
  const rows = [
    row({ id: 'lamp-s', kind: 'light', type: 'point', color: [1, 1, 1], brightness: 1, reach: 8, pos: [0, 2, 0], shadow: true }),
    row({ id: 'spot-p', kind: 'light', type: 'spot', color: [1, 0.5, 0], brightness: 2, reach: 6, pos: [1, 3, 1], cone: [20, 30] }),
    row({ id: 'spot-s', kind: 'light', type: 'spot', color: [0.5, 1, 0], brightness: 1.5, reach: 7, pos: [-1, 3, 1], cone: [10, 40], shadow: true }),
  ];
  const cells = new Array(8).fill(-1);
  pool.apply(planRoomLights(CELLS, 1, 0.18, pool.shape, new RoomLightEdits(rows, []).forRoom('place/house-1', 'ours_house', CELLS))!, M, cells);
  for (const l of pool.all()) l.updateMatrixWorld();
  for (const l of [...pool.spots, ...pool.spotShadows]) l.target.updateMatrixWorld();
  const fx = createFxLights();
  resetFxLights(fx);
  fillRoomLightFx(fx.rooms, pool, cells);
  const R = fx.rooms;
  ok(R.pointCount === 4 && R.ambient.r > 0 && R.parallel.luminance > 0, `the room's own lamps, its ambient and its parallel are read off the pool (${R.pointCount} lamps)`);
  ok(R.extraPoints === 1 && R.extraCount === 3 && R.extra[0].position.distanceTo(pool.pointShadows[0].position) < 1e-9, 'the casting point is the first of the other slots, as a point; the two spots after it, as points the air glows round');
  ok(R.spotCount === 2 && R.spots[0].position.distanceTo(pool.spots[0].position) < 1e-9 && R.spots[1].position.distanceTo(pool.spotShadows[0].position) < 1e-9 && Math.abs(R.spots[0].coneCos - Math.cos(pool.spots[0].angle)) < 1e-12, 'the spots with their cones, plain then casting');
  ok(R.extra.slice(0, 3).every((p) => p.cell === 1) && R.spots.slice(0, 2).every((s) => s.cell === 1), 'each with the cell it was lit from');
  const g = {
    uRoomSpotPos: { value: new Float32Array(8) },
    uRoomSpotDir: { value: new Float32Array(8) },
    uRoomSpotCone: { value: new Float32Array(6) },
    uRoomSpotCount: { value: 0 },
    uRoomCastPos: { value: new Float32Array(4) },
    uRoomCastLum: { value: new Float32Array(2) },
    uRoomCastCount: { value: 0 },
  };
  fillRoomPoolUniforms(g, R, true, 2, 1);
  ok(g.uRoomSpotCount.value === 2 && Math.abs(g.uRoomSpotPos.value[0] - R.spots[0].position.x) < 1e-4 && Math.abs(g.uRoomSpotPos.value[4] - R.spots[1].position.x) < 1e-4 && Math.abs(g.uRoomSpotDir.value[3] - R.spots[0].luminance) < 1e-4, "the occlusion is handed both spots lit, each its place, way, light and cone");
  ok(g.uRoomCastCount.value === 1 && Math.abs(g.uRoomCastPos.value[0] - R.extra[0].position.x) < 1e-4 && Math.abs(g.uRoomCastLum.value[0] - R.extra[0].luminance) < 1e-4, 'and the casting point in arrays of its own, never behind the flash pool and the plain lamps');
  fillRoomPoolUniforms(g, R, false, 2, 1);
  ok(g.uRoomSpotCount.value === 0 && g.uRoomCastCount.value === 0, "where the rooms' set does not apply, none");
}

// ---- 4. A light hung on a row. ----

{
  const good = readAttachments([{ light: { type: 'spot', color: [1, 0.8, 0.6], brightness: 1, reach: 12, cone: [25, 35], shadow: true }, at: [0, 1.5, 0], q: [0, 1, 0, 0] }]);
  ok(Array.isArray(good) && good.length === 1 && good[0].light?.type === 'spot' && good[0].at?.[1] === 1.5 && good[0].q?.[1] === 1, 'a light hung on a row reads, with its place and its turn');
  ok(readAttachments([{ light: { type: 'point', color: [1, 1, 1], brightness: 1, reach: 6 }, size: 2 }]) === null, 'a light carrying a size is refused');
  ok(readAttachments([{ light: { type: 'point', color: [1, 1, 1], brightness: 1, reach: 6, glow: 1 } }]) === null && readAttachments([{ light: { type: 'directional', color: [1, 1, 1], brightness: 1, reach: 6 } }]) === null, "a light the reader refuses (a field it has not got, a directional's reach) is refused whole");
  ok(readAttachments([{ light: { type: 'point', color: [1, 1, 1], brightness: 1, reach: 6 }, fx: 'props:particles/fire.json' }]) === null, 'a light and an effect in one attachment are refused');
  let moved = 0;
  const holder = new RowAttachments<object>({
    fileOf: () => null,
    prepare: async () => true,
    place: () => ({}),
    move: () => {},
    resize: () => {},
    remove: () => {},
    sound: () => {},
    soundMove: () => {},
    soundOff: () => {},
    lightsMoved: () => moved++,
  });
  ok(holder.lightList().length === 0, 'with nothing stood, no light');
  const lampRow = { id: 'lamp-1', kind: 'prop', pack: 'props', thing: 't', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], attach: [{ fx: 'props:particles/fire.json' }, { light: good![0].light, at: [0, 1.5, 0] }] } as unknown as PlacementRow;
  holder.stand('place/lamp-1', lampRow, { x: 10, y: 0, z: -5, q: [0, 0, 0, 1] });
  const list = holder.lightList();
  ok(moved === 1 && list.length === 1 && list[0].key === 'att:place/lamp-1#1' && list[0].rowKey === 'place/lamp-1' && list[0].index === 1 && list[0].spec.type === 'spot', 'a row carrying a light stood: listed under its row and its place in the row, and the world told');
  ok(Math.abs(list[0].world.elements[13] - 1.5) < 1e-9 && Math.abs(list[0].world.elements[12] - 10) < 1e-9, 'its matrix its row\'s place times its own');
  ok(holder.lightList() === list, 'asked again with nothing moved, the very same list');
  holder.drop('place/lamp-1');
  ok(moved === 2 && holder.lightList().length === 0, 'its row taken away: gone from the list, and the world told');
}

// ---- 5. The hand-overs only the page makes. ----

{
  const main = text('src/main.ts');
  ok(/this\.world\.lightsSource = \(pack, kind\) => this\.fetchLights\(pack, kind\);/.test(main), "the page hands the world its fetch of the lights files");
  const fetchBody = /private async fetchLights\(pack: string, kind: [^)]*\): Promise<[^{]*\{([\s\S]*?)\n  \}\n/.exec(main)?.[1] ?? '';
  ok(/const \[w, a\] = await Promise\.all\(\[this\.readLightsRows\(pack, k\), this\.readLightsRows\(null, k\)\]\);/.test(fetchBody) && /return \{ world: w && w !== 'unread' \? w\.rows : \[\], all: a && a !== 'unread' \? a\.rows : \[\]/.test(fetchBody), "the world's file is read as the world's and the shared one as every world's");
  const reload = /private async reloadLights\(pack: string \| null, rev: string \| undefined\): Promise<void> \{([\s\S]*?)\n  \}\n/.exec(main)?.[1] ?? '';
  ok(/this\.world\.setRoomLightRows\(pack === null \? e\.world : rows, pack === null \? rows : e\.all\);/.test(reload), 'a file read again for the dev server\'s word goes in its own slot, the other kept');
  ok(/const lgf = files\.lights;/.test(main) && /landRows\(e\.world as LightRow\[\], lgf\.put as unknown as LightRow\[\], lgf\.deleted\)/.test(main) && /landRows\(e\.all as LightRow\[\], gf\.put as unknown as LightRow\[\], gf\.deleted\)/.test(main), "the editor's own write lands each file's rows over that file's rows in force");
  const world = text('src/world/world.ts');
  ok(/portals\.roomShadows = this\.roomPool;/.test(world) && /portals\.roomShadowHooks = \{ before: \(\) => batches\.around\(\), after: \(\) => batches\.restore\(\) \};/.test(world), "the world hands the portal renderer its pool's casting slots and the batches' hooks for the rooms' own shadow pass");
  ok(/fillRoomLightFx\(rooms, this\.roomPool, this\.fxLampCells\);/.test(world), "the effects' rooms are filled from the pool by `fillRoomLightFx`, run above");
  ok(/live: \(l\) => w\.roomLightLive\(l\),/.test(text('src/editor/editorEntry.ts')), "the editor hands the world the hand's light as one record");
}

console.log(`\nroomLightsWorld: ${checks} checks passed`);
