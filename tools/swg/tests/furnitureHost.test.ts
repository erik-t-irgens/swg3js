// Which building holds each thing placed inside one (src/world/furnitureHost.ts), checked without a
// browser. First a made-up building of two rooms and a door, turned and placed, for every rule with a known
// answer: the host is the building whose room box (grown by `boxPad`) holds the origin, the rooms are every
// room its sphere reaches (a long table whose origin and middle stand well inside one room carries the room
// its far end reaches into), a sphere reaching the door to the world makes it a doorway thing, a room past 63
// takes any room, two buildings holding one point go to the smaller room, a model with no portals hosts
// nothing, and a building taken out of the index hosts nothing more. Then how the switch draws the meshes
// (`splitCopies`, `furnitureDraw`): off, exactly the old rule's meshes and every copy once; on, every copy
// once, per building; a mesh hidden for failing to draw never shown; a room's furniture compiled for both
// passes (`markFurniture`). Then the real Tatooine and Naboo packs: the counts per town against the census
// the design rests on (Mos Eisley 725 objects in 22 buildings, Bestine 1,112 in 26, Theed 120 in 12) and
// against hosting's own answer (how many hosted, in no room box and in a doorway, per town and per world);
// no object held by two buildings anywhere on either world; every hosted object's rooms holding the room box
// that holds its origin, the one that holds its middle and every one that holds a corner of its own turned
// box; and the switch's two sides over each town's loaded furniture, the old one mesh for mesh the old rule's.
// What only a browser runs (the streamer building both sides and letting a taken-up house's furniture go,
// the renderer leaving a broken mesh hidden, every compile sweep building both passes for furniture) is read
// from the sources.
//
// The packs are read only for their layouts and room boxes; nothing is written, and only counts are printed.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FURNITURE_ROLE, FURNITURE_TUNE, FurnitureIndex, HOST_FLAG, furnitureDraw, furnitureHosts, isFurniture, markFurniture, maskHas, maskSeen, splitCopies, type FurnitureDraw, type FurnitureGroup, type HostAnswer, type HostDef, type HostObject } from '../../../src/world/furnitureHost.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

function quad(x0: number, x1: number, y0: number, y1: number, z: number): { v: number[][]; i: number[] } {
  return { v: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], i: [0, 1, 2, 0, 2, 3] };
}

// Two rooms along z: the front (z -5 to 0) and the back (z 0 to 5), a doorway at z 0 and the door to the world at z 5.
const twoRooms: HostDef & { id: string } = {
  id: 'test_two_rooms',
  bounds: { min: [-5, 0, -5], max: [5, 3, 5] },
  cells: [
    { index: 0, bounds: { min: [-5, 0, -5], max: [5, 3, 5] }, portals: [{ geometry: 1, target: 2 }] },
    { index: 1, bounds: { min: [-5, 0, -5], max: [5, 3, 0] }, portals: [{ geometry: 0, target: 2 }] },
    // Stored the other way round, as some packs store a box's corners: the index must sort them.
    { index: 2, bounds: { min: [5, 3, 5], max: [-5, 0, 0] }, portals: [{ geometry: 0, target: 1 }, { geometry: 1, target: 0 }] },
  ],
  portals: [quad(-1, 1, 0, 2.2, 0), quad(-1, 1, 0, 2.2, 5)],
};
// A chair's model: 0.6 m across, its origin on the floor.
const chair: HostDef & { id: string } = { id: 'chair', bounds: { min: [-0.3, 0, -0.3], max: [0.3, 0.9, 0.3] } };
// A long bench, 4 m, and a room past 63.
const bench: HostDef & { id: string } = { id: 'bench', bounds: { min: [-2, 0, -0.3], max: [2, 0.5, 0.3] } };
const deep: HostDef & { id: string } = {
  id: 'deep',
  bounds: { min: [-5, 0, -5], max: [5, 3, 5] },
  cells: [
    { index: 0, bounds: { min: [-5, 0, -5], max: [5, 3, 5] }, portals: [{ geometry: 0, target: 70 }] },
    { index: 70, bounds: { min: [-5, 0, -5], max: [5, 3, 5] }, portals: [{ geometry: 0, target: 0 }] },
  ],
  portals: [quad(-1, 1, 0, 2.2, 5)],
};
const noPortals: HostDef & { id: string } = { id: 'shed', bounds: { min: [-5, 0, -5], max: [5, 3, 5] }, cells: [{ index: 0, bounds: { min: [-5, 0, -5], max: [5, 3, 5] } }, { index: 1, bounds: { min: [-5, 0, -5], max: [5, 3, 5] } }] };
// A long table, 3 m along its own z, its origin in its middle: stood with its middle a metre inside the front
// room it reaches half a metre into the back one, which neither its origin nor its middle is anywhere near.
const table: HostDef & { id: string } = { id: 'table', bounds: { min: [-0.4, 0, -1.5], max: [0.4, 0.8, 1.5] } };
// The same table with its box off to one side of its origin, as a model's box often is: its middle stands
// 1.2 m along its own x from where it is placed, so which way that is turned decides the rooms it reaches.
const shelf: HostDef & { id: string } = { id: 'shelf', bounds: { min: [0.9, 0, -0.3], max: [1.5, 2, 0.3] } };
const DEFS = new Map<string, HostDef>([twoRooms, chair, bench, deep, noPortals, table, shelf].map((d) => [d.id, d]));

// ---- 1. The made-up building, turned a third of the way round and placed. ----
{
  const yaw = 2.1;
  const place = new THREE.Vector3(120, 4, -60);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const m = new THREE.Matrix4().compose(place, q, new THREE.Vector3(1, 1, 1));
  /** A thing at a point in the building's own frame, turned with it. */
  const at = (model: string, x: number, y: number, z: number, contained = true, turn = 0): HostObject => {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(m);
    const oq = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn));
    return { model, x: p.x, y: p.y, z: p.z, q: { x: oq.x, y: oq.y, z: oq.z, w: oq.w }, contained };
  };
  const building: HostObject = { model: 'test_two_rooms', x: place.x, y: place.y, z: place.z, q: { x: q.x, y: q.y, z: q.z, w: q.w }, contained: false };
  const objects: HostObject[] = [
    building,
    at('chair', 0, 0, -3), // 1: the front room's middle
    at('chair', 3, 0, 3), // 2: the back room, away from both doors
    at('chair', 0, 0, -0.1), // 3: the front room, reaching into the back
    at('chair', 0, 0, 4.9), // 4: at the door to the world
    at('chair', 0, 0, 20), // 5: outside, but called contained
    at('chair', 0, 0, -3, false), // 6: not contained at all
    at('bench', 0, 0, -3, true, Math.PI / 2), // 7: a bench turned across the front room, 4 m long, reaching both side walls
    at('chair', 0, 0, -5.4), // 8: just outside the front wall, within the pad
    at('table', 0, 0, -1), // 9: a long table along z, its origin and middle a metre inside the front room
    at('shelf', 0, 0, -0.9, true, -Math.PI / 2), // 10: a shelf whose box stands 1.2 m along its own x, turned so that is toward the back room
  ];
  const h = furnitureHosts(objects, (id) => DEFS.get(id));
  ok(h.stats.hosts === 1 && h.index.size === 1, 'the one building with rooms and portals is indexed, and hosts');
  ok(h.host[1] === 0 && maskHas(h.rooms[2], h.rooms[3], 1) && !maskHas(h.rooms[2], h.rooms[3], 2) && h.flags[1] === 0, 'a chair in the middle of the front room is the building\'s, in the front room alone');
  ok(h.host[2] === 0 && maskHas(h.rooms[4], h.rooms[5], 2) && !maskHas(h.rooms[4], h.rooms[5], 1), 'a chair in the back room is in the back room alone, in a box whose corners were stored the other way round');
  ok(h.host[3] === 0 && maskHas(h.rooms[6], h.rooms[7], 1) && maskHas(h.rooms[6], h.rooms[7], 2) && !(h.flags[3] & HOST_FLAG.doorway), 'a chair by the doorway between the rooms can be seen in both, and is not a doorway thing (that doorway is not to the world)');
  ok(h.host[4] === 0 && (h.flags[4] & HOST_FLAG.doorway) !== 0, 'a chair at the door to the world is a doorway thing');
  ok(h.host[5] === -1 && h.host[6] === -1, 'a thing outside every room box has no host, nor does a thing not contained at all');
  ok(h.host[7] === 0 && maskHas(h.rooms[14], h.rooms[15], 1) && maskHas(h.rooms[14], h.rooms[15], 2) === false, 'a bench across the front room is in the front room: its sphere reaches the doorway wall only where the pad allows');
  ok(h.host[8] === 0 && maskHas(h.rooms[16], h.rooms[17], 1), 'a chair just outside the front wall, within the pad, is the front room\'s');
  ok(h.host[9] === 0 && maskHas(h.rooms[18], h.rooms[19], 1) && maskHas(h.rooms[18], h.rooms[19], 2) && !(h.flags[9] & HOST_FLAG.doorway), 'a long table whose origin and middle are a metre inside the front room can be seen in the back room its far end reaches into, so it never pops at the doorway');
  ok(h.host[10] === 0 && maskHas(h.rooms[20], h.rooms[21], 1) && maskHas(h.rooms[20], h.rooms[21], 2), 'a shelf whose box stands off its origin is measured where its box is turned to: placed in the front room, it reaches the back room');
  ok(h.stats.contained === 9 && h.stats.hosted === 8 && h.stats.noBox === 1 && h.stats.doorway === 1 && h.stats.twoHosts === 0, `the counts: ${JSON.stringify(h.stats)}`);
  // The snapshot's own word (step 7): the building it names, and the room it files a thing in added to the
  // rooms the boxes find, never put in their place.
  const named: HostObject[] = objects.map((o, i) => (i === 1 ? { ...o, hostIndex: 0, cell: 2 } : i === 9 ? { ...o, hostIndex: 0, cell: 1 } : i === 5 ? { ...o, hostIndex: 0, cell: 1 } : o));
  const hn = furnitureHosts(named, (id) => DEFS.get(id));
  ok(hn.host[1] === 0 && maskHas(hn.rooms[2], hn.rooms[3], 2) && maskHas(hn.rooms[2], hn.rooms[3], 1), 'a chair the snapshot files in the back room while it stands in the front one is seen from both: its own room is added, the room it stands in is kept');
  ok(hn.host[9] === 0 && maskHas(hn.rooms[18], hn.rooms[19], 1) && maskHas(hn.rooms[18], hn.rooms[19], 2), 'a long table filed in the front room is still seen from the back room its far end reaches into');
  ok(hn.host[5] === 0 && maskHas(hn.rooms[10], hn.rooms[11], 1) && hn.stats.exact === 3 && hn.stats.noBox === 0, "and a thing in no room's box is hosted by the building and the room the snapshot names");
  const off = furnitureHosts(named, (id) => DEFS.get(id), { ...FURNITURE_TUNE, exactRooms: false });
  ok(off.host[5] === -1 && off.stats.exact === 0 && !maskHas(off.rooms[2], off.rooms[3], 2), 'with the switch off the snapshot\'s word is not read at all');
  // Two buildings over one point: the smaller room wins, and it is flagged.
  const idx = new FurnitureIndex(FURNITURE_TUNE);
  idx.add(0, building, twoRooms);
  idx.add(1, { model: 'deep', x: place.x, y: place.y, z: place.z, q: { x: 0, y: 0, z: 0, w: 1 }, contained: false }, deep);
  const a: HostAnswer = { host: -1, lo: 0, hi: 0, flags: 0 };
  idx.assign(objects[1], chair, a);
  ok(a.host === 0 && (a.flags & HOST_FLAG.twoHosts) !== 0, 'a point held by the rooms of two buildings goes to the one whose room is smaller, and says so');
  // A building whose one room is past 63: any room of it.
  const idx2 = new FurnitureIndex(FURNITURE_TUNE);
  idx2.add(5, { model: 'deep', x: 0, y: 0, z: 0, q: { x: 0, y: 0, z: 0, w: 1 }, contained: false }, deep);
  idx2.assign({ model: 'chair', x: 0, y: 0, z: -2, q: { x: 0, y: 0, z: 0, w: 1 }, contained: true }, chair, a);
  ok(a.host === 5 && (a.flags & HOST_FLAG.anyRoom) !== 0 && a.lo === 0 && a.hi === 0, 'a room numbered past 63 is taken as any room of the building');
  // A model with rooms and no portals hosts nothing: its rooms are drawn with the world.
  ok(!idx2.add(6, { model: 'shed', x: 50, y: 0, z: 50, q: { x: 0, y: 0, z: 0, w: 1 }, contained: false }, noPortals) && !FurnitureIndex.hosts(noPortals) && FurnitureIndex.hosts(twoRooms), 'a building with rooms and no portals hosts nothing');
  idx2.remove(5);
  idx2.assign({ model: 'chair', x: 0, y: 0, z: -2, q: { x: 0, y: 0, z: 0, w: 1 }, contained: true }, chair, a);
  ok(a.host === -1 && idx2.size === 0, 'a building taken out of the index hosts nothing more');
  // What the portal renderer asks of a mask.
  const seen = new Uint8Array([0, 0, 1, 2, 0]);
  ok(maskSeen(1 << 2, 0, false, seen) && !maskSeen((1 << 1) | (1 << 3), 0, false, seen) && maskSeen(0, 0, true, seen) && !maskSeen(0, 0, true, new Uint8Array(4)), 'a mask is seen when a room it names is seen (not one room past), and "any room" when any room is');
  const wide = new Uint8Array(64);
  wide[40] = 1;
  ok(maskSeen(0, 1 << 8, false, wide) && !maskSeen(0, 1 << 9, false, wide) && maskHas(0, 1 << 8, 40), 'and rooms 32 to 63 are the second word');
}

// ---- 2. How the switch draws the meshes: the old rule's own with it off, per building with it on. ----

/** A copy as the streamer holds one: indoors or not, and the building that holds it. */
interface Copy {
  id: number;
  contained: boolean;
  host?: string;
}

/**
 * The meshes one piece's copies are made into, and which copies each side of the switch draws: every mesh
 * shown off (`visible`) or on (`visible`, or routed and so shown with its building's rooms), each copy
 * counted once per mesh that draws it. `old` is the old rule's grouping: the outdoor copies, and the
 * indoor ones together. Answers whether each side draws each copy exactly once and whether the off side's
 * meshes are the old rule's, member for member and in order.
 */
function sides(copies: Copy[]): { onceOff: boolean; onceOn: boolean; oldOff: boolean; meshesOn: number; meshesOff: number } {
  const split = splitCopies<Copy, string>(copies);
  const d: FurnitureDraw = { wait: false, routed: false, visible: false, rooms: false, castShadow: false };
  const offLists: Copy[][] = [];
  const onCount = new Map<number, number>();
  const offCount = new Map<number, number>();
  let meshesOn = 0;
  for (const s of split) {
    // A plain mesh (role -1) is drawn either way, on the layers it was built with.
    const g: FurnitureGroup = { mesh: new THREE.Object3D(), lo: 0, hi: 0, any: false, ready: true, routed: false, cast: true, role: s.role, twinned: s.role === FURNITURE_ROLE.room };
    const off = s.role < 0 || furnitureDraw(g, false, false, d).visible;
    const onDraw = s.role < 0 || furnitureDraw(g, true, false, d).visible || d.routed;
    if (off) {
      offLists.push(s.list);
      for (const c of s.list) offCount.set(c.id, (offCount.get(c.id) ?? 0) + 1);
    }
    if (onDraw) {
      meshesOn++;
      for (const c of s.list) onCount.set(c.id, (onCount.get(c.id) ?? 0) + 1);
    }
  }
  const once = (m: Map<number, number>) => copies.every((c) => m.get(c.id) === 1);
  const old = [copies.filter((c) => !c.contained), copies.filter((c) => c.contained)].filter((l) => l.length);
  const oldOff = old.length === offLists.length && old.every((l, i) => l.length === offLists[i].length && l.every((c, j) => c === offLists[i][j]));
  return { onceOff: once(offCount), onceOn: once(onCount), oldOff, meshesOn, meshesOff: offLists.length };
}

{
  const mixed: Copy[] = [
    { id: 0, contained: false },
    { id: 1, contained: true, host: 'cantina' },
    { id: 2, contained: true },
    { id: 3, contained: true, host: 'hotel' },
    { id: 4, contained: true, host: 'cantina' },
    { id: 5, contained: false },
  ];
  const s = sides(mixed);
  ok(s.oldOff && s.onceOff && s.meshesOff === 2, 'with the switch off, exactly the old rule\'s meshes are drawn: the outdoor copies and every indoor copy together, each once');
  ok(s.onceOn && s.meshesOn === 4, 'with it on, each copy once: outdoors, the loose ones, and one mesh per building that holds any');
  const none = sides([{ id: 0, contained: true }, { id: 1, contained: false }]);
  ok(none.oldOff && none.onceOn && none.meshesOn === 2 && splitCopies<Copy, string>([{ id: 0, contained: true }]).every((x) => x.role < 0), 'a piece no building holds is the old mesh itself, and no switch moves it');
  const d: FurnitureDraw = { wait: false, routed: false, visible: false, rooms: false, castShadow: false };
  const group = (role: number, twinned: boolean, ready = true): FurnitureGroup => ({ mesh: new THREE.Object3D(), lo: 0, hi: 0, any: false, ready, routed: false, cast: true, role, twinned });
  furnitureDraw(group(FURNITURE_ROLE.room, true), true, false, d);
  ok(d.routed && d.rooms && !d.castShadow && !d.visible, 'on, a building\'s own mesh is on the rooms\' layer alone, casts nothing and is left to the portal renderer to show with its rooms');
  furnitureDraw(group(FURNITURE_ROLE.room, true), false, false, d);
  ok(!d.routed && !d.rooms && d.castShadow && !d.visible, 'off, it is hidden: its twin draws its copies as the old rule did');
  furnitureDraw(group(FURNITURE_ROLE.room, false), false, false, d);
  ok(!d.routed && !d.rooms && d.castShadow && d.visible, 'a thing put down in play has no twin: off, its own mesh is drawn on the actor layer, as it always was');
  furnitureDraw(group(FURNITURE_ROLE.plain, false), true, false, d);
  const plainOn = d.visible && !d.routed && !d.rooms && d.castShadow;
  furnitureDraw(group(FURNITURE_ROLE.plain, false), false, false, d);
  ok(plainOn && d.visible && !d.routed, 'a mesh whose building was taken up is drawn on the actor layer whatever the switch says, never waiting on a pass that will not come');
  furnitureDraw(group(FURNITURE_ROLE.room, false, false), true, false, d);
  ok(d.wait && !d.visible && !d.routed, 'before its programs exist it is left hidden, on the layers it was built and compiled with');
  let shown = 0;
  for (const role of [FURNITURE_ROLE.room, FURNITURE_ROLE.whenOn, FURNITURE_ROLE.whenOff, FURNITURE_ROLE.plain]) for (const on of [false, true]) if (furnitureDraw(group(role, false), on, true, d).visible) shown++;
  ok(shown === 0, 'a mesh the portal renderer hid for failing to draw is never shown again by a switch');
  const m = new THREE.Mesh();
  ok(!isFurniture(m), 'an ordinary mesh is compiled for the passes its layers give it');
  markFurniture(m);
  m.layers.set(22);
  ok(isFurniture(m), "a room's furniture is known as such on whatever layer it stands now, so every sweep builds both passes' programs for it");
  // The wiring no node test can run (the streamer, the renderer and the world are browser modules), read from the sources.
  const read = (p: string) => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8');
  const world = read('world/world.ts');
  const passesOf = world.slice(world.indexOf('private static passesOf('), world.indexOf('compileTarget: () =>'));
  ok(passesOf.includes('if (actor || isFurniture(o)) return [0, INTERIOR_LAYER];'), "every compile sweep builds a room's furniture for both the world's pass and the rooms', whatever layer the switch has it on now");
  const stream = read('world/layoutStream.ts');
  const unplace = stream.slice(stream.indexOf('  unplace(template: string): boolean {'), stream.indexOf('  objectsNear('));
  ok(unplace.includes('this.unhost(placed);') && /g\.role = FURNITURE_ROLE\.plain;[\s\S]*this\.applyFurniture\(g\);/.test(unplace) && unplace.includes('p.host = undefined;'), 'a house taken up lets go of what stood in it: each mesh drawn as the old rule drew it, each thing no longer filed under it');
  ok(stream.includes('splitCopies<PlacedObject, PlacedObject>(all)') && stream.includes('for (const g of this.furnitureSwaps) this.applyFurniture(g);'), "the streamer builds the switch's two sides and flips both");
  const render = read('world/portalRender.ts');
  ok(render.includes('markQuarantined(culprit);') && render.includes('if (show && isQuarantined(list[i])) show = false;') && render.includes('&& !isQuarantined(g.mesh);'), "a mesh hidden for failing to draw is marked, and a building's rooms and furniture, shown pass by pass, leave it hidden");
}

// ---- 3. The real packs. ----
const TIERS = [
  { minRadius: 12, range: 1700 },
  { minRadius: 3, range: 750 },
  { minRadius: 0, range: 320 },
];
const REGION = 256;
const root = new URL('../../../assets-private/', import.meta.url);
interface LayoutObj {
  model: string;
  x: number;
  y: number;
  z: number;
  q: number[];
  radius: number;
  contained?: boolean;
  /** The snapshot's own building row and room (step 7), in a pack converted with them. */
  cell?: number;
  in?: number;
}

/** A world read as the streamer reads it: mirrored in x and centred, each object's radius kept for its tier. */
function world(planet: string): { objects: (HostObject & { radius: number })[]; defs: Map<string, HostDef>; center: { x: number; z: number }; exact: (HostObject & { radius: number })[] } | null {
  const lu = new URL(`${planet}/layout.json`, root);
  const mu = new URL(`${planet}/manifest.json`, root);
  if (!existsSync(lu) || !existsSync(mu)) return null;
  const layout = JSON.parse(readFileSync(lu, 'utf8')) as { center: { x: number; z: number }; objects: LayoutObj[] };
  const manifest = JSON.parse(readFileSync(mu, 'utf8')) as { categories: Record<string, (HostDef & { id: string })[]> };
  const defs = new Map<string, HostDef>();
  for (const list of Object.values(manifest.categories)) for (const d of list) defs.set(d.id, d);
  const c = layout.center;
  const objects = layout.objects.map((o) => ({ model: o.model, x: -(o.x - c.x), y: o.y, z: o.z - c.z, q: { x: o.q[1], y: -o.q[2], z: -o.q[3], w: o.q[0] }, contained: !!o.contained, radius: o.radius }));
  // The same objects with the snapshot's own building and room where the pack carries them, as the streamer reads them.
  const exact = layout.objects.map((o, i) => (o.contained && typeof o.in === 'number' && typeof o.cell === 'number' ? { ...objects[i], hostIndex: o.in, cell: o.cell } : objects[i]));
  return { objects, defs, center: c, exact };
}

/**
 * The towns, with the census the design rests on (`objects`, `buildings`: the things in rooms loaded round
 * each and how many buildings hold them) and what hosting itself answers there, as measured on the
 * converted packs: at least `hostedMin` of them hosted, at most `noBoxMax` in no room box (the design's
 * census has 41 at Mos Eisley), and `doorway` standing in a door to the world, give or take one.
 */
const TOWNS: { planet: string; name: string; x: number; z: number; objects: number; buildings: number; hostedMin: number; noBoxMax: number; doorway: number }[] = [
  { planet: 'tatooine', name: 'Mos Eisley', x: 3618.98, z: -4801.09, objects: 725, buildings: 22, hostedMin: 680, noBoxMax: 41, doorway: 4 },
  { planet: 'tatooine', name: 'Bestine', x: -1376.15, z: -3576.23, objects: 1112, buildings: 26, hostedMin: 1105, noBoxMax: 3, doorway: 1 },
  { planet: 'naboo', name: 'Theed', x: -4795.27, z: 4238.79, objects: 120, buildings: 12, hostedMin: 117, noBoxMax: 0, doorway: 0 },
];
/** What hosting answers over each whole world, as measured: in no room box, and in a doorway to the world. */
const WORLDS: Record<string, { noBox: number; noBoxSlack: number; doorway: number }> = {
  tatooine: { noBox: 53, noBoxSlack: 3, doorway: 9 },
  naboo: { noBox: 4, noBoxSlack: 2, doorway: 3 },
};

let realRuns = 0;
for (const planet of ['tatooine', 'naboo']) {
  const w = world(planet);
  if (!w) {
    console.log(`skip ${planet}: not converted (assets-private/${planet}/layout.json)`);
    continue;
  }
  realRuns++;
  const t0 = performance.now();
  const h = furnitureHosts(w.objects, (id) => w.defs.get(id));
  const ms = performance.now() - t0;
  console.log(`     ${planet}: ${JSON.stringify(h.stats)} in ${ms.toFixed(0)} ms`);
  ok(h.stats.twoHosts === 0 && h.stats.hosted > 0, `${planet}: of ${h.stats.contained} things placed in rooms, ${h.stats.hosted} have a host and not one is held by the rooms of two buildings`);
  const whole = WORLDS[planet];
  if (whole) ok(Math.abs(h.stats.noBox - whole.noBox) <= whole.noBoxSlack && Math.abs(h.stats.doorway - whole.doorway) <= 1 && h.stats.hosted + h.stats.noBox === h.stats.contained, `${planet}: hosting's own answer is ${h.stats.noBox} in no room box and ${h.stats.doorway} in a doorway to the world, against ${whole.noBox} and ${whole.doorway} measured`);
  // Every hosted object's rooms hold the room box that holds its origin (grown by the pad), the one that holds
  // its middle, and every one (grown by the pad) that holds a corner of its own box turned and placed: a piece
  // reaching across a doorway can be seen from either side of it. Run over the rooms' boxes' hosting here, and
  // over the snapshot's own below, where it must hold just the same.
  const reach = (hh: typeof h) => {
  let missOrigin = 0;
  let missMiddle = 0;
  let missCorner = 0;
  let corners = 0;
  let checked = 0;
  const inv = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const oq = new THREE.Quaternion();
  for (let i = 0; i < w.objects.length; i++) {
    const hi = hh.host[i];
    if (hi < 0) continue;
    const o = w.objects[i];
    const bo = w.objects[hi];
    const bdef = w.defs.get(bo.model);
    inv.compose(new THREE.Vector3(bo.x, bo.y, bo.z), new THREE.Quaternion(bo.q.x, bo.q.y, bo.q.z, bo.q.w), new THREE.Vector3(1, 1, 1)).invert();
    const od = w.defs.get(o.model);
    oq.set(o.q.x, o.q.y, o.q.z, o.q.w);
    const mid = od?.bounds ? new THREE.Vector3((od.bounds.min[0] + od.bounds.max[0]) / 2, (od.bounds.min[1] + od.bounds.max[1]) / 2, (od.bounds.min[2] + od.bounds.max[2]) / 2) : new THREE.Vector3();
    const middle = mid.applyQuaternion(oq).add(new THREE.Vector3(o.x, o.y, o.z)).applyMatrix4(inv);
    p.set(o.x, o.y, o.z).applyMatrix4(inv);
    // The eight corners of its own box, each axis taken as an extent (a pack's corners may be either way round).
    const boxCorners: THREE.Vector3[] = [];
    const ob = od?.bounds;
    if (ob && ob.min.length >= 3 && ob.max.length >= 3) {
      const lo = [0, 1, 2].map((a) => Math.min(ob.min[a], ob.max[a]));
      const up = [0, 1, 2].map((a) => Math.max(ob.min[a], ob.max[a]));
      for (let k = 0; k < 8; k++) boxCorners.push(corner.set(k & 1 ? up[0] : lo[0], k & 2 ? up[1] : lo[1], k & 4 ? up[2] : lo[2]).applyQuaternion(oq).add(new THREE.Vector3(o.x, o.y, o.z)).applyMatrix4(inv).clone());
    }
    for (const c of bdef?.cells ?? []) {
      if (c.index <= 0 || c.index >= 64) continue;
      const lo = [0, 1, 2].map((a) => Math.min(c.bounds.min[a], c.bounds.max[a]));
      const up = [0, 1, 2].map((a) => Math.max(c.bounds.min[a], c.bounds.max[a]));
      const pad = FURNITURE_TUNE.boxPad;
      const holdsOrigin = [0, 1, 2].every((a) => p.getComponent(a) >= lo[a] - pad && p.getComponent(a) <= up[a] + pad);
      const holdsMiddle = [0, 1, 2].every((a) => middle.getComponent(a) >= lo[a] && middle.getComponent(a) <= up[a]);
      // A hair inside the grown box, so a corner exactly on the sphere's edge is not decided by rounding.
      const inGrown = (v: THREE.Vector3) => [0, 1, 2].every((a) => v.getComponent(a) >= lo[a] - pad + 1e-6 && v.getComponent(a) <= up[a] + pad - 1e-6);
      const holdsCorner = boxCorners.some(inGrown);
      const has = maskHas(hh.rooms[i * 2], hh.rooms[i * 2 + 1], c.index);
      if (holdsOrigin && !has) missOrigin++;
      if (holdsMiddle && !has) missMiddle++;
      if (holdsCorner) {
        corners++;
        if (!has) missCorner++;
      }
    }
    checked++;
  }
  return { missOrigin, missMiddle, missCorner, corners, checked };
  };
  const byBox = reach(h);
  ok(byBox.missOrigin === 0 && byBox.missMiddle === 0 && byBox.checked === h.stats.hosted, `${planet}: every one of ${byBox.checked} hosted things can be seen in the room whose box holds its origin and the room whose box holds its middle`);
  ok(byBox.missCorner === 0 && byBox.corners > byBox.checked, `${planet}: and in every room whose box holds a corner of its own turned box (${byBox.corners} such rooms), so nothing pops at a doorway it reaches across`);
  // Step 7: the snapshot's own building and room, where the pack carries them.
  const named = w.exact.filter((o) => typeof o.hostIndex === 'number').length;
  if (!named) console.log(`skip  ${planet}: the pack names no object's building and room (converted before step 7)`);
  else {
    const ex = furnitureHosts(w.exact, (id) => w.defs.get(id));
    let wrongRoom = 0;
    let agree = 0;
    let both = 0;
    let wider = 0;
    for (let i = 0; i < w.exact.length; i++) {
      const o = w.exact[i];
      if (typeof o.hostIndex !== 'number' || ex.host[i] < 0) continue;
      const cell = o.cell as number;
      const lo = ex.rooms[i * 2];
      const hi = ex.rooms[i * 2 + 1];
      // Its own room is always among the rooms it is seen in (a room past 63 is "any room").
      if (cell < 64 && !maskHas(lo, hi, cell)) wrongRoom++;
      if (cell < 64 && (cell < 32 ? lo !== (1 << cell) >>> 0 || hi !== 0 : hi !== (1 << (cell - 32)) >>> 0 || lo !== 0)) wider++;
      if (h.host[i] >= 0) {
        both++;
        if (h.host[i] === ex.host[i]) agree++;
      }
    }
    console.log(`     ${planet} by the snapshot's own rooms: ${JSON.stringify(ex.stats)}; the rooms' boxes found the same building for ${agree} of ${both}; ${wider} are seen from more rooms than the one they are filed in`);
    ok(ex.stats.exact > 0 && ex.stats.twoHosts === 0 && wrongRoom === 0, `${planet}: ${ex.stats.exact} things are hosted by the building the snapshot names and are always seen from the room it files them in`);
    // The 2b guarantee holds on the snapshot's hosting too: the room it names is added to the boxes' rooms, never put in their place.
    const byName = reach(ex);
    ok(byName.missOrigin === 0 && byName.missMiddle === 0 && byName.missCorner === 0 && byName.checked === ex.stats.hosted && wider > 0, `${planet}: and hosted so, every one of ${byName.checked} is still seen from every room whose box holds its origin, its middle or a corner of its turned box (${byName.corners} such rooms), so a thing reaching through a doorway or filed in the room next door never pops`);
    ok(ex.stats.noBox <= h.stats.noBox && ex.stats.hosted >= h.stats.hosted, `${planet}: and none that the rooms' boxes hosted is lost (${ex.stats.noBox} in no room, against ${h.stats.noBox} by the boxes)`);
    ok(both > 0 && agree / both > 0.99, `${planet}: where both answer, the boxes chose the snapshot's own building ${(100 * agree / both).toFixed(2)}% of the time`);
  }
  for (const town of TOWNS) {
    if (town.planet !== planet) continue;
    const px = -(town.x - w.center.x);
    const pz = town.z - w.center.z;
    let loaded = 0;
    let effects = 0;
    let hosted = 0;
    let noBox = 0;
    let doorway = 0;
    const buildings = new Set<number>();
    // The indoor copies of each model in each tier and region, as the streamer instances them, each with the
    // building the streamer files it under (none for one in a doorway, which keeps the old rule).
    const pieces = new Map<string, Copy[]>();
    for (let i = 0; i < w.objects.length; i++) {
      const o = w.objects[i];
      if (!o.contained || !w.defs.get(o.model)) continue;
      // Loaded around the town as the streamer loads them: the object's region within its tier's range.
      const t = Math.max(0, TIERS.findIndex((tt) => o.radius >= tt.minRadius));
      const rx = Math.floor(o.x / REGION);
      const rz = Math.floor(o.z / REGION);
      if (Math.hypot((rx + 0.5) * REGION - px, (rz + 0.5) * REGION - pz) > TIERS[t].range) continue;
      // A particle effect placed in a room is counted by the census and is no mesh: it is placed, not hosted.
      if (w.defs.get(o.model)?.particle) {
        effects++;
        continue;
      }
      loaded++;
      const key = `${t}|${rx},${rz}|${o.model}`;
      let copies = pieces.get(key);
      if (!copies) pieces.set(key, (copies = []));
      const filed = h.host[i] >= 0 && !(h.flags[i] & HOST_FLAG.doorway);
      copies.push({ id: i, contained: true, ...(filed ? { host: String(h.host[i]) } : {}) });
      if (h.host[i] < 0) {
        noBox++;
        continue;
      }
      hosted++;
      buildings.add(h.host[i]);
      if (h.flags[i] & HOST_FLAG.doorway) doorway++;
    }
    console.log(`     ${town.name}: ${loaded} things and ${effects} particle effects in rooms loaded, ${hosted} hosted in ${buildings.size} buildings, ${noBox} in no room box, ${doorway} in a doorway to the world`);
    ok(Math.abs(loaded + effects - town.objects) <= 3 && Math.abs(buildings.size - town.buildings) <= 2, `${town.name}: ${loaded + effects} things in rooms (${effects} of them effects) in ${buildings.size} buildings, against the census's ${town.objects} in ${town.buildings}`);
    ok(hosted >= town.hostedMin && noBox <= town.noBoxMax && Math.abs(doorway - town.doorway) <= 1, `${town.name}: hosting's own answer, ${hosted} hosted (at least ${town.hostedMin}), ${noBox} in no room box (at most ${town.noBoxMax}), ${doorway} in a doorway (${town.doorway} measured)`);
    // The switch's two sides over the town's furniture, a model's piece at a time (each piece of a model is
    // one mesh per group, so these count groups, not draws).
    let offGroups = 0;
    let onGroups = 0;
    let oldGroups = 0;
    let bad = 0;
    for (const copies of pieces.values()) {
      const s = sides(copies);
      if (!s.onceOff || !s.onceOn || !s.oldOff) bad++;
      offGroups += s.meshesOff;
      onGroups += s.meshesOn;
      oldGroups++;
    }
    console.log(`     ${town.name}: the old rule's ${oldGroups} indoor groups, drawn with the switch off as ${offGroups}; with it on, ${onGroups} (per building, and the loose ones)`);
    ok(bad === 0 && offGroups === oldGroups, `${town.name}: with the furniture switch off, the old rule's groups exactly (${offGroups} of ${oldGroups}); with it on, every copy in exactly one mesh`);
  }
}
if (!realRuns) console.log('skip the converted packs are not here (assets-private/<planet>/layout.json)');

console.log(`\n${checks} checks passed`);
