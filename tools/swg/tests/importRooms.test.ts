// A house of the owner's own with rooms through the import pass (Map-maker II's eleventh wave, `tools/swg/importRooms.mjs`
// and `imports.mjs`): the TEST house, built here out of nothing of the game's (`blenderGlb.ts`), two rooms behind a shell:
//
//   1. its cells, each box its own pieces, its floor and every corner of its doorways, padded by `--cell-pad=` (the front
//      doorway stands a tenth of a metre past the hall's own pieces, and the hall's box reaches it; a floor reaching past its
//      room's walls grows that room's box); its doorways and two floor halves drawn about their own origins and placed by
//      their nodes' moves and turns, as Blender writes them, so the pass is held to baking every node;
//   2. its doorways both ways round, each the polygon Blender drew, and the GLB's own level a node a room
//      (`cell:<n>:<name>`) with no doorway or floor drawn in it, which the walk grid's bake reads as the game's own cells;
//   3. its lights: the hall's lamp by the cell it is under, the parlour's by the room whose box holds it, each a point in its
//      own colour whose constants the room pool's own rule (`roomLights.ts`) reads back as the lamp's range and brightness,
//      for every whole range from 14 to 40; a lamp in no room, one of no brightness, one reaching too near or too far and
//      one too bright, each said; a sun turned every way pointing down its own -Z; a room of nine lamps said;
//   4. its floors read by the indoor nav's own reader (`buildFloor`): two halves of the hall's welded into one floor, the
//      one drawn face down turned up; its door by its style's name and nothing of the style's, hung at its doorway's bottom
//      middle and turned half round by its empty's own X, one far from any doorway said and left out, one nearer the inner
//      doorway taking that doorway and its two rooms, and a door object's own mesh left out, never drawn or solid;
//   5. the refusals in words: a doorway not flat, one of no area, one naming a room that does not exist, a floor of a room
//      that does not exist, a room no doorway reaches from outside, and beside them a room's name that does not read, rooms
//      numbered with a gap, an empty room, an empty shell, a house filed as a prop; a room with no floor said;
//   5b. how it collides: under `auto` room by room and the shell on its own, so a stand-in for the shell never takes the
//      rooms' floors; a walked room left nothing that collides (`stand-in` naming none there, `none`, every piece -nocol)
//      refused, one behind a window alone not; and a doorway's first triangle, the one the game reads its plane off, never
//      of no area and always its largest;
//   6. the folder's `floors.json` and `doors.json`, written with a house and gone with the last one, and a fresh record of a
//      source naming rooms a building;
//   7. day one: a model naming no room imported byte for byte as 441c2f6's own pass imports it (its `imports.mjs` out of git,
//      else the answer recorded from it), its GLB, its manifest's and library's entries and the folder's files.
//
// Run: node tools/swg/tests/importRooms.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IMPORT_TUNE, dropImport, importModel, readSource, roomRefusal, runImport, tuneOf, writeImport } from '../imports.mjs';
import { ROOM_LIGHT_BRIGHTEST, ROOM_LIGHT_RANGE, roomName, roomPointAttenuation } from '../importRooms.mjs';
import { readGlb } from '../sceneglb.mjs';
import { readGlbTriangles } from '../navgrid.mjs';
import { TEST_HOUSE, TEST_HOUSE_RECORD, TEST_HUT_RECORD, TEST_PLATE_RECORD, testHouse, testHut, testPlate, writeRawGlb, yawQ, type RawGltf } from './blenderGlb.ts';
import { loadOld } from './oldModules.ts';
import { pointLightAt3, pointLightRange } from '../../../src/world/roomLights.ts';
import { buildFloor } from '../../../src/world/nav/navMesh.ts';

let checks = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
}

const tmp = mkdtempSync(join(tmpdir(), 'swg-import-rooms-'));
const close = (a: number, b: number, e = 1e-4) => Math.abs(a - b) < e;
const boxIs = (b: { min: number[]; max: number[] }, want: { min: number[]; max: number[] }) => [0, 1, 2].every((k) => close(b.min[k], want.min[k]) && close(b.max[k], want.max[k]));

/** A RawGltf written as a .glb in the scratch folder and read back as the pass reads a source. */
let n = 0;
function sourceOf(doc: RawGltf, stem = `house${n++}`) {
  const file = join(tmp, `${stem}.glb`);
  writeFileSync(file, writeRawGlb(doc));
  return readSource(file);
}
type Made = ReturnType<typeof importModel>;
const H = TEST_HOUSE;
const made = importModel(sourceOf(testHouse()), TEST_HOUSE_RECORD, IMPORT_TUNE) as Made & { def: Record<string, any>; floors: Record<string, any>; doors: any[]; entry: Record<string, any> };
ok(!made.refuse, `the TEST house imports (${made.refuse?.join('; ') ?? 'no refusal'})`);
const cells = made.def.cells as { index: number; name: string; bounds: { min: number[]; max: number[] }; portals: { geometry: number; target: number; passable: boolean }[]; lights?: { type: number; color: number[]; position: number[]; direction: number[]; attenuation: number[] }[] }[];
const cellOf = (i: number) => cells.find((c) => c.index === i)!;

// ---------------------------------------------------------------- 1. the cells and their boxes
{
  ok(cells.length === 3 && cells.map((c) => `${c.index}:${c.name}`).join() === '0:shell,1:hall,2:parlour', `three cells, named and numbered as Blender's objects say (${cells.map((c) => `${c.index}:${c.name}`).join(', ')})`);
  const pad = IMPORT_TUNE.cellPad;
  // The hall's own pieces: walls at x +-3.8 (0.05 thick), floor 0..0.1, ceiling to 3.05, from its front wall's face at z -0.1
  // back to its back wall's at -5.0; its doorways at z 0 (the front, 0.1 past its pieces) and z -5.
  const hallOwn = { min: [-3.85, 0, -5], max: [3.85, 3.05, H.hallFront] };
  ok(close(cellOf(1).bounds.max[2], H.front.z + pad) && cellOf(1).bounds.max[2] > hallOwn.max[2] + pad, `the hall's box reaches its front doorway (z ${cellOf(1).bounds.max[2]}), which stands ${H.front.z - H.hallFront} m past its own pieces: padded by its doorways' corners`);
  ok(boxIs(cellOf(1).bounds, { min: [-3.85 - pad, -pad, -5 - pad], max: [3.85 + pad, 3.05 + pad, 0 + pad] }), `the hall's box is its pieces and its doorways, grown by --cell-pad (${JSON.stringify(cellOf(1).bounds)})`);
  ok(boxIs(cellOf(2).bounds, { min: [-3.85 - pad, -pad, -9.9 - pad], max: [3.85 + pad, 3.05 + pad, H.inner.z + pad] }), `the parlour's box reaches the inner doorway at z -5 (${JSON.stringify(cellOf(2).bounds)})`);
  const bare = importModel(sourceOf(testHouse()), TEST_HOUSE_RECORD, tuneOf({ 'cell-pad': '0' }) as typeof IMPORT_TUNE) as typeof made;
  ok(!bare.refuse && boxIs(bare.def.cells[1].bounds, { min: [-3.85, 0, -5], max: [3.85, 3.05, 0] }), `--cell-pad=0 leaves the box at its pieces and doorways exactly (${JSON.stringify(bare.def.cells[1].bounds)})`);
  ok(typeof tuneOf({ 'cell-pad': '-1' }) === 'string' && typeof tuneOf({ 'portal-flat': '0' }) === 'string' && (tuneOf({ 'light-scale': '2' }) as typeof IMPORT_TUNE).lightScale === 2, "the rooms' numbers are the command's flags: a padding of nought is one, a negative one and a flatness of nought are not");
  ok(made.entry.rooms === 2 && made.entry.doors === 1 && made.entry.kind === 'building', 'the library entry says two rooms and one door');
  // A floor reaching past its room's own pieces (a bay the walls do not close yet) grows the room's box to it.
  const bay = testHouse();
  bay.meshes.push({ name: 'Bay', primitives: [{ positions: [3.75, 0.1, -6, 4.6, 0.1, -6, 4.6, 0.1, -7, 3.75, 0.1, -7], indices: [0, 2, 1, 0, 3, 2] }] });
  bay.nodes.push({ name: 'floor:2.001', mesh: bay.meshes.length - 1 });
  bay.scenes![0].nodes.push(bay.nodes.length - 1);
  const bayMade = importModel(sourceOf(bay), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  ok(!bayMade.refuse && close(bayMade.def.cells[2].bounds.max[0], 4.6 + pad) && close(bayMade.def.cells[1].bounds.max[0], 3.85 + pad), `a floor reaching past its room's pieces grows that room's box to it (the parlour's to x ${bayMade.def.cells[2].bounds.max[0]}), and no other's`);
}

// ---------------------------------------------------------------- 2. the doorways, and the GLB
{
  const portals = made.def.portals as { v: number[][]; i: number[] }[];
  ok(portals.length === 2, 'two doorways');
  const corners = (d: typeof H.front) => [[-d.x, d.y0, d.z], [d.x, d.y0, d.z], [d.x, d.y1, d.z], [-d.x, d.y1, d.z]];
  const same = (a: number[][], b: number[][]) => a.length === b.length && a.every((v, k) => v.every((x, j) => close(x, b[k][j])));
  ok(same(portals[0].v, corners(H.front)) && portals[0].i.length === 6, 'the front doorway is the polygon Blender drew, two triangles');
  ok(same(portals[1].v, corners(H.inner)), 'and so is the inner one');
  const links = (i: number) => cellOf(i).portals.map((p) => `${p.geometry}>${p.target}${p.passable ? '' : '!'}`).join();
  ok(links(0) === '0>1' && links(1) === '0>0,1>2' && links(2) === '1>1', `each doorway listed both ways round (shell ${links(0)}, hall ${links(1)}, parlour ${links(2)})`);
  const g = readGlb(made.glb) as { json: { nodes: { name: string; mesh?: number }[]; scenes: { nodes: number[] }[] } };
  const own = g.json.scenes[0].nodes.map((k) => g.json.nodes[k].name);
  ok(own.join() === 'cell:0:shell,cell:1:hall,cell:2:parlour', `the GLB's own level is a node a room, named as the converter names a portal building's cells (${own.join(', ')})`);
  // What the walk grid's bake reads of it: every drawn triangle in its room, and no doorway or floor among them.
  const file = join(tmp, 'house-baked.glb');
  writeFileSync(file, made.glb);
  const tri = readGlbTriangles(file);
  const byCell = [0, 0, 0];
  for (const c of tri.cells) byCell[c]++;
  ok(tri.cells.length === made.entry.tri && byCell[0] === 7 * 12 && byCell[1] === 10 * 12 && byCell[2] === 8 * 12, `the bake reads its triangles by room (${byCell.join(', ')}: the shell's seven boxes, the hall's ten, the parlour's eight), no doorway or floor drawn`);
  const window = importModel(sourceOf(renamed(testHouse(), 'portal:1:2', 'portal:1:2!')), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  ok(!window.refuse && window.def.cells[1].portals.some((p: { target: number; passable: boolean }) => p.target === 2 && !p.passable) && window.notes.some((w: string) => /seen only through a window/.test(w)), 'portal:<a>:<b>! is a window: listed, never walked through, and a room behind one alone is said');
}

/** A house with one object renamed. */
function renamed(doc: RawGltf, from: string, to: string): RawGltf {
  return { ...doc, nodes: doc.nodes.map((x) => (x.name === from ? { ...x, name: to } : x)) };
}
/** A house without the objects named. */
function without(doc: RawGltf, ...names: string[]): RawGltf {
  const drop = new Set(doc.nodes.map((x, i) => (names.includes(x.name as string) ? i : -1)).filter((i) => i >= 0));
  // Every index kept, so the children lists still point right: a dropped object becomes an empty with no name.
  return { ...doc, nodes: doc.nodes.map((x, i) => (drop.has(i) ? { name: `gone${i}` } : x)) };
}

// ---------------------------------------------------------------- 3. the lights
{
  const hall = cellOf(1).lights ?? [];
  const parlour = cellOf(2).lights ?? [];
  const hallPoint = hall.find((l) => l.type === 2)!;
  const parlourPoint = parlour.find((l) => l.type === 2)!;
  ok(hall.length === 2 && parlour.length === 1 && !(cellOf(0).lights ?? []).length, `the hall carries its own fill and its lamp, the parlour its lamp, the shell none (${hall.length}, ${parlour.length})`);
  ok(hall.some((l) => l.type === 0 && l.color.join() === H.hallAmbient.join()), "the hall's custom property `ambient` is its fill light");
  ok(hallPoint.position.every((v, k) => close(v, H.hallLamp.at[k])) && parlourPoint.position.every((v, k) => close(v, H.parlourLamp.at[k])), 'the hall lamp by the cell it is under, the parlour lamp (under no cell) by the room whose box holds it, each where it stands');
  ok(hallPoint.color.join() === H.hallLamp.color.join() && parlourPoint.color.join() === H.parlourLamp.color.join(), `each lamp keeps its own colour (${hallPoint.color.join(' ')}; ${parlourPoint.color.join(' ')})`);
  ok(pointLightRange(hallPoint.attenuation) === H.hallLamp.range && close(pointLightAt3(hallPoint.attenuation), H.hallLamp.intensity / 9, 1e-4), `the room pool's own rule reads the hall lamp back at its range, ${pointLightRange(hallPoint.attenuation)} m, and its brightness at 3 m, ${pointLightAt3(hallPoint.attenuation).toFixed(4)} (${H.hallLamp.intensity} cd over 9)`);
  ok(pointLightRange(parlourPoint.attenuation) === IMPORT_TUNE.lightReach && close(pointLightAt3(parlourPoint.attenuation), H.parlourLamp.intensity / 9, 1e-4), `the parlour lamp names no range, and reaches --light-reach (${pointLightRange(parlourPoint.attenuation)} m)`);
  let every = 0;
  for (let r = ROOM_LIGHT_RANGE.least; r <= ROOM_LIGHT_RANGE.most; r++) for (const b of [0.5, 10, ROOM_LIGHT_BRIGHTEST]) if (pointLightRange(roomPointAttenuation(r, b)) === r && close(pointLightAt3(roomPointAttenuation(r, b)), b / 9, 1e-4 * b)) every++;
  ok(every === (ROOM_LIGHT_RANGE.most - ROOM_LIGHT_RANGE.least + 1) * 3, `for every whole range from ${ROOM_LIGHT_RANGE.least} to ${ROOM_LIGHT_RANGE.most} m and three brightnesses the constants are read back by the game's own rule as written (${every})`);
  // A doubled scale doubles the brightness and moves no range.
  const twice = importModel(sourceOf(testHouse()), TEST_HOUSE_RECORD, tuneOf({ 'light-scale': '2' }) as typeof IMPORT_TUNE) as typeof made;
  const p2 = (twice.def.cells[1].lights as typeof hall).find((l) => l.type === 2)!;
  ok(close(pointLightAt3(p2.attenuation), (2 * H.hallLamp.intensity) / 9, 1e-4) && pointLightRange(p2.attenuation) === H.hallLamp.range, '--light-scale=2 doubles a lamp at 3 m and leaves its range');
  // A lamp in no room, one too near, one too far, one too bright, a spot and a sun.
  const doc = testHouse();
  const lights = (doc.extensions!.KHR_lights_punctual as { lights: Record<string, unknown>[] }).lights;
  const SUN_COLOR = [1, 0.8, 0.6];
  lights.push({ type: 'point', intensity: 5, range: 6 }, { type: 'point', intensity: 5, range: 90 }, { type: 'point', intensity: 900 }, { type: 'spot', intensity: 5, spot: {} }, { type: 'directional', intensity: 3, color: SUN_COLOR }, { type: 'point', intensity: 5 }, { type: 'point', intensity: 0 });
  const at = (light: number, p: number[], name: string) => doc.nodes.push({ name, translation: p, extensions: { KHR_lights_punctual: { light } } });
  at(2, [0, 2, -3], 'Near');
  at(3, [1, 2, -3], 'Far');
  at(4, [-1, 2, -3], 'Bright');
  at(5, [2, 2, -3], 'Spot');
  at(6, [0, 2.5, -8], 'Sun');
  at(7, [0, 2, 20], 'Street');
  at(8, [-2, 2, -3], 'Dark');
  (doc.scenes as { nodes: number[] }[])[0].nodes.push(...doc.nodes.map((_, i) => i).slice(-7));
  // The sun turned every way at once, so its direction (its own -Z, glTF's) is pinned on all three axes.
  const qn = Math.hypot(0.3, 0.4, -0.2, 0.84);
  const SUN_Q = [0.3 / qn, 0.4 / qn, -0.2 / qn, 0.84 / qn];
  doc.nodes.find((x) => x.name === 'Sun')!.rotation = SUN_Q;
  const turn = (q: number[], v: number[]) => {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  };
  const sunWay = turn(SUN_Q, [0, 0, -1]);
  const lit = importModel(sourceOf(doc), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  const hl = lit.def.cells[1].lights as typeof hall;
  const range = (x: number[]) => pointLightRange(hl.find((l) => l.type === 2 && close(l.position[0], x[0]) && close(l.position[2], x[2]))!.attenuation);
  ok(range([0, 0, -3]) === ROOM_LIGHT_RANGE.least && range([1, 0, -3]) === ROOM_LIGHT_RANGE.most && lit.notes.some((w: string) => /no nearer than 14 m/.test(w)) && lit.notes.some((w: string) => /no farther than 40 m/.test(w)), 'a lamp reaching too near or too far reaches the nearest the rule gives, and says so');
  // Past the brightest, the rule holds a light's 3 m value at its cap whatever its constants, but the range it works out
  // from them is another: held to the brightest, the light reaches what it was given.
  const bright = hl.find((l) => close(l.position[0], -1) && close(l.position[2], -3))!.attenuation;
  ok(close(pointLightAt3(bright), ROOM_LIGHT_BRIGHTEST / 9, 1e-4) && pointLightRange(bright) === IMPORT_TUNE.lightReach && lit.notes.some((w: string) => /180 cd at most/.test(w)), `one past the brightest the rule reads is held to it, reaching what it was given (${pointLightRange(bright)} m), and says so`);
  ok(hl.some((l) => l.type === 2 && close(l.position[0], 2)) && lit.notes.some((w: string) => /spot light: drawn as a point/.test(w)), 'a spot is a point, said');
  const sun = (lit.def.cells[2].lights as typeof hall).find((l) => l.type === 1);
  ok(!!sun && lit.notes.some((w: string) => /a sun in room 2/.test(w)), "a sun is its room's parallel light, said");
  ok(!!sun && sun.direction.every((v, k) => close(v, sunWay[k], 1e-3)) && sun.color.join() === SUN_COLOR.join(), `pointing down its own -Z as its node turns it (${sun?.direction.join(' ')} against ${sunWay.map((v) => v.toFixed(3)).join(' ')}), in its own colour`);
  ok(!lit.def.cells.some((c: { lights?: { position: number[] }[] }) => (c.lights ?? []).some((l) => close(l.position[0], -2) && close(l.position[2], -3))) && lit.notes.some((w: string) => /Dark has no brightness: left out/.test(w)), 'a lamp of no brightness is left out, said');
  ok(!lit.def.cells.some((c: { lights?: { position: number[] }[] }) => (c.lights ?? []).some((l) => close(l.position[2], 20))) && lit.notes.some((w: string) => /Street stands in no room: left out/.test(w)), 'a lamp in no room is left out, said');
  ok(!made.notes.some((w: string) => /light\(s\) left out/.test(w)), "a house's lamps are its rooms' lights, never said to be left out");
  // A lamp under the hall's cell standing inside the parlour's box keeps the hall (the hierarchy first), and one under no
  // cell standing where both rooms' boxes meet (the inner doorway's plane) takes the smaller room, the parlour.
  const astray = testHouse();
  const al = (astray.extensions!.KHR_lights_punctual as { lights: Record<string, unknown>[] }).lights;
  al.push({ type: 'point', intensity: 4 }, { type: 'point', intensity: 4 });
  astray.nodes.push({ name: 'HallLampAstray', translation: [1.5, 2.6, -7.5], extensions: { KHR_lights_punctual: { light: 2 } } });
  (astray.nodes.find((x) => x.name === 'cell:1:hall')!.children as number[]).push(astray.nodes.length - 1);
  astray.nodes.push({ name: 'DoorwayLamp', translation: [-1.5, 2.6, H.inner.z], extensions: { KHR_lights_punctual: { light: 3 } } });
  astray.scenes![0].nodes.push(astray.nodes.length - 1);
  const ta = importModel(sourceOf(astray), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  const lightsAt = (c: number, x: number) => ((ta.def.cells[c].lights ?? []) as typeof hall).some((l) => l.type === 2 && close(l.position[0], x));
  ok(!ta.refuse && lightsAt(1, 1.5) && !lightsAt(2, 1.5), "a lamp under a room's cell is that room's wherever it stands");
  ok(lightsAt(2, -1.5) && !lightsAt(1, -1.5), 'a lamp under no cell where two rooms\' boxes meet is the smaller room\'s');
  // A room of more point lamps than the room pool lights at once is said; one of exactly as many is not.
  const crowded = (extra: number) => {
    const d = testHouse();
    const dl = (d.extensions!.KHR_lights_punctual as { lights: Record<string, unknown>[] }).lights;
    for (let i = 0; i < extra; i++) {
      dl.push({ type: 'point', intensity: 2 });
      d.nodes.push({ name: `Many${i}`, translation: [-3 + i * 0.7, 2.5, -2], extensions: { KHR_lights_punctual: { light: dl.length - 1 } } });
      (d.nodes.find((x) => x.name === 'cell:1:hall')!.children as number[]).push(d.nodes.length - 1);
    }
    return importModel(sourceOf(d), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  };
  const nine = crowded(8);
  const eight = crowded(7);
  ok(!nine.refuse && nine.notes.some((w: string) => /a room holds 9 point lights: the room pool lights eight at once/.test(w)) && !eight.notes.some((w: string) => /point lights: the room pool/.test(w)), 'a room of nine point lamps is said, one of eight is not');
  // A room's ambient that is not three numbers from 0 to 4 is said and left out.
  const badAmbient = testHouse();
  badAmbient.nodes.find((x) => x.name === 'cell:2:parlour')!.extras = { ambient: [1, 2] };
  const tb = importModel(sourceOf(badAmbient), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  ok(!tb.refuse && !((tb.def.cells[2].lights ?? []) as typeof hall).some((l) => l.type === 0) && tb.notes.some((w: string) => /1 room\(s\) with an ambient that is not three numbers/.test(w)), "an ambient that is not three numbers is said and left out");
}

// ---------------------------------------------------------------- 4. the floors and the door
{
  const f1 = buildFloor(made.floors['1'].floor);
  const f2 = buildFloor(made.floors['2'].floor);
  ok(!!f1 && f1.count === 4 && f1.openEdges === 6, `the hall's floor, two halves meeting at an edge, reads as one floor through the nav's own reader: four triangles, six open edges where unwelded it would be eight (${f1?.count}, ${f1?.openEdges})`);
  let down = 0;
  for (let t = 0; f1 && t < f1.count; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => f1.tris[t * 3 + k] * 3);
    const v = f1.verts;
    const ny = (v[b + 2] - v[a + 2]) * (v[c] - v[a]) - (v[b] - v[a]) * (v[c + 2] - v[a + 2]);
    if (ny <= 0) down++;
  }
  ok(down === 0, 'every floor triangle wound face up, the half drawn face down turned');
  ok(!!f2 && f2.count === 2 && f2.openEdges === 4 && !made.floors['0'], "the parlour's floor reads, and the shell has none");
  ok(made.doors.length === 1, 'one door');
  const d = made.doors[0];
  ok(Object.keys(d).join() === 'portal,style,cells,m' && d.portal === 0 && d.style === H.doorStyle && d.cells.join() === '0,1', `the door is its doorway, its style's name and its two rooms, and nothing of the style's numbers (${JSON.stringify(d)})`);
  ok(close(d.m[3], 0) && close(d.m[7], H.front.y0) && close(d.m[11], H.front.z) && close(d.m[0], 1) && close(d.m[10], 1), "hung at its doorway's bottom middle, upright, its Z through the doorway");
  const turned = testHouse();
  const dn = turned.nodes.find((x) => x.name === `door:${H.doorStyle}`)!;
  dn.rotation = yawQ(Math.PI);
  const t2 = importModel(sourceOf(turned), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  ok(close(t2.doors[0].m[0], -1) && close(t2.doors[0].m[10], -1) && close(t2.doors[0].m[5], 1), "an empty turned half round turns its door half round (which way its leaf slides)");
  const far = testHouse();
  far.nodes.push({ name: 'door:cantina_door.001', translation: [0, 0.1, 8] });
  (far.scenes as { nodes: number[] }[])[0].nodes.push(far.nodes.length - 1);
  const t3 = importModel(sourceOf(far), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  ok(t3.doors.length === 1 && t3.notes.some((w: string) => /door:cantina_door\.001 stands .* from the nearest doorway/.test(w)), 'a door far from any doorway is said and left out');
  const twoDoors = testHouse();
  twoDoors.nodes.push({ name: 'door:cantina_door.002', translation: [0, H.front.y0, H.front.z - 0.1] });
  twoDoors.scenes![0].nodes.push(twoDoors.nodes.length - 1);
  const t4 = importModel(sourceOf(twoDoors), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  ok(t4.doors.length === 1 && t4.notes.some((w: string) => /door:cantina_door\.002: portal:0:1 has a door already \(door:cantina_door\)/.test(w)), 'a second door in a doorway that has one is said and left out');
  // A door between the two doorways, nearer the inner one, takes the inner one: its row names that doorway and its rooms,
  // and it hangs at that doorway's bottom middle.
  const inner = testHouse();
  inner.nodes.push({ name: 'door:poi_all_barn_door', translation: [0.2, H.inner.y0, H.inner.z + 0.4] });
  inner.scenes![0].nodes.push(inner.nodes.length - 1);
  const t7 = importModel(sourceOf(inner), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  const innerDoor = t7.doors.find((x: { style: string }) => x.style === 'poi_all_barn_door');
  ok(t7.doors.length === 2 && !!innerDoor && innerDoor.portal === 1 && innerDoor.cells.join() === '1,2', `a door nearer the inner doorway is that doorway's, between the hall and the parlour (${JSON.stringify(innerDoor && { portal: innerDoor.portal, cells: innerDoor.cells })})`);
  ok(!!innerDoor && close(innerDoor.m[3], 0) && close(innerDoor.m[7], H.inner.y0) && close(innerDoor.m[11], H.inner.z), `and hangs at its bottom middle, not where its empty stands (${innerDoor && [innerDoor.m[3], innerDoor.m[7], innerDoor.m[11]].join(', ')})`);
  // A door object carrying a mesh (a placeholder leaf, as a hand naturally draws one) is the door's marker: its mesh is left
  // out, never drawn or solid, and said.
  const boxed = testHouse();
  boxed.nodes.find((x) => x.name === `door:${H.doorStyle}`)!.mesh = 0;
  const t8 = importModel(sourceOf(boxed), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  ok(!t8.refuse && t8.doors.length === 1 && t8.entry.tri === made.entry.tri && t8.entry.colTri === made.entry.colTri && t8.notes.some((w: string) => /1 door:<style> object\(s\) carry a mesh: taken for the door's marker and left out/.test(w)), `a door object's own mesh is left out, never drawn or solid, said (${t8.entry.tri} triangles drawn, as without it)`);
  // A floor triangle standing on its edge (a riser) is no floor, and the shell's floor is the ground's.
  const riser = testHouse();
  riser.meshes.push({ name: 'Riser', primitives: [{ positions: [-1, 0.1, -7, 1, 0.1, -7, 0, 0.6, -7], indices: [0, 1, 2] }] });
  riser.nodes.push({ name: 'floor:2.001', mesh: riser.meshes.length - 1 }, { name: 'floor:0', mesh: 7 });
  riser.scenes![0].nodes.push(riser.nodes.length - 2, riser.nodes.length - 1);
  const t5 = importModel(sourceOf(riser), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  ok(!t5.refuse && t5.floors['2'].floor.t.length === 6 && t5.notes.some((w: string) => /1 floor triangle\(s\) standing on their edges left out/.test(w)), "a floor triangle standing on its edge is left out of the room's floor, said");
  ok(!t5.floors['0'] && t5.notes.some((w: string) => /floor:0: the shell's floor is the ground's/.test(w)), "the shell's floor is the ground's: floor:0 left out, said");
  // A piece under no cell is the shell's, drawn in the shell's own node.
  const chimney = testHouse();
  chimney.nodes.push({ name: 'Chimney', mesh: 0, translation: [2, 3.8, -7], scale: [0.3, 0.4, 0.3] });
  chimney.scenes![0].nodes.push(chimney.nodes.length - 1);
  const t6 = importModel(sourceOf(chimney), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  const cfile = join(tmp, 'house-chimney.glb');
  writeFileSync(cfile, t6.glb);
  const shellTris = readGlbTriangles(cfile).cells.filter((c: number) => c === 0).length;
  ok(!t6.refuse && shellTris === 8 * 12 && t6.notes.some((w: string) => /1 piece\(s\) under no cell: made the shell's/.test(w)), `a piece under no cell is drawn as the shell's (${shellTris} triangles in cell 0), said`);
}

// ---------------------------------------------------------------- 5. the refusals
{
  const refused = (doc: RawGltf, record = TEST_HOUSE_RECORD) => (importModel(sourceOf(doc), record, IMPORT_TUNE) as { refuse?: string[] }).refuse ?? [];
  const bent = testHouse();
  const meshes = bent.meshes as { primitives: { positions: number[] }[] }[];
  // The front doorway's third corner pushed 0.6 m through the wall: the best plane through its four corners leaves each
  // about a quarter of that off it, three times the flatness a doorway may lack.
  meshes[3].primitives[0].positions[8] += 0.6;
  const r1 = refused(bent);
  ok(r1.some((w) => /portal:0:1 is not flat: a corner stands 0\.1\d+ m off its plane, past 0\.05 m/.test(w)), `a doorway that is not flat is refused in words ("${r1[0]}")`);
  const slip = testHouse();
  (slip.meshes as { primitives: { positions: number[] }[] }[])[3].primitives[0].positions[8] += 0.02;
  ok(!refused(slip).length, 'a corner slipped two centimetres is no bent doorway');
  const r2 = refused(renamed(testHouse(), 'portal:1:2', 'portal:1:5'));
  ok(r2.some((w) => /portal:1:5 joins a room that does not exist \(5\)/.test(w)), `a doorway naming a room that does not exist is refused ("${r2[0]}")`);
  const r3 = refused(without(testHouse(), 'portal:1:2'));
  ok(r3.some((w) => /room 2 \(parlour\): no doorway leads to it from outside/.test(w)), `a room no doorway reaches from outside is refused ("${r3[0]}")`);
  ok(refused(renamed(testHouse(), 'cell:2:parlour', 'cell:3:parlour')).some((w) => /no cell:2/.test(w)), 'rooms numbered with a gap are refused');
  ok(refused(renamed(testHouse(), 'cell:2:parlour', 'cell:2:4way')).some((w) => /begins with a digit/.test(w)), 'a cell whose own name begins with a digit is refused, as ever');
  ok(refused(renamed(testHouse(), 'portal:0:1', 'portal:front')).some((w) => /portal:front is not portal:<room>:<room>/.test(w)) && roomRefusal('door:') !== null && roomRefusal('Cellar') === null && roomRefusal('cell:1:hall') === null, "a room's name that does not read is refused in words; one that reads, or a name merely beginning with the word, is none");
  const emptyHall = testHouse();
  emptyHall.nodes.find((x) => x.name === 'cell:1:hall')!.children = [];
  ok(refused(emptyHall).some((w) => /room 1 \(hall\) holds nothing/.test(w)), 'a room holding nothing is refused');
  const noShell = testHouse();
  noShell.nodes.find((x) => x.name === 'cell:0:shell')!.children = [];
  ok(refused(noShell).some((w) => /the shell .* holds nothing/.test(w)), 'a shell holding nothing is refused');
  ok(refused(testHouse(), { ...TEST_HOUSE_RECORD, kind: 'prop' }).some((w) => /its record's kind is building, where it says prop/.test(w)), 'a house with rooms filed as a prop is refused in words');
  ok(refused(renamed(testHouse(), 'portal:1:2', 'portal:2:2')).some((w) => /joins room 2 to itself/.test(w)), 'a doorway joining a room to itself is refused');
  // A doorway of no area: its four corners in a row (as a doorway drawn edge on and collapsed might be).
  const flat = testHouse();
  (flat.meshes as { primitives: { positions: number[] }[] }[])[4].primitives[0].positions = [-0.6, 0, -0.1, 0, 0, -0.1, 0.6, 0, -0.1, 0.3, 0, -0.1];
  const r4 = refused(flat);
  ok(r4.some((w) => /portal:1:2 has no area: a doorway is a flat polygon filling the opening/.test(w)), `a doorway of no area is refused in words, not thrown ("${r4[0]}")`);
  // A floor of a room that does not exist.
  const stray = testHouse();
  stray.nodes.push({ name: 'floor:5', mesh: 7, translation: [0, 0.1, -7.45] });
  stray.scenes![0].nodes.push(stray.nodes.length - 1);
  const r5 = refused(stray);
  ok(r5.some((w) => /floor:5 is the floor of a room that does not exist/.test(w)), `a floor of a room that does not exist is refused in words ("${r5[0]}")`);
  // A room with no floor of its own is said, and imported (a body in it steers straight).
  const bareRoom = importModel(sourceOf(without(testHouse(), 'floor:2')), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  ok(!bareRoom.refuse && !bareRoom.floors['2'] && bareRoom.notes.some((w: string) => /room 2 \(parlour\) has no floor:2/.test(w)) && !made.notes.some((w: string) => /has no floor:/.test(w)), 'a room with no floor is said and imported, and the TEST house says no such thing');
  const twoNames = testHouse();
  twoNames.nodes.push({ name: 'cell:1:lobby' });
  twoNames.scenes![0].nodes.push(twoNames.nodes.length - 1);
  ok(refused(twoNames).some((w) => /cell:1 is named both hall and lobby/.test(w)), 'one room named two ways by two of its objects is refused');
  const doorOnly = testHut();
  doorOnly.nodes.push({ name: 'door:cantina_door' });
  ok(refused(doorOnly, TEST_HUT_RECORD).some((w) => /and no room: name each room cell:<n>:<name>/.test(w)), 'a door named in a model that names no room is refused');
  const onlyShell: RawGltf = { ...testHut(), nodes: [{ name: 'cell:0:shell', children: [1] }, ...testHut().nodes.slice(0, 1)] };
  const shellOnly = importModel(sourceOf(onlyShell), TEST_HUT_RECORD, IMPORT_TUNE) as typeof made;
  ok(!shellOnly.refuse && !shellOnly.def.cells && shellOnly.notes.some((w: string) => /only the shell is named/.test(w)), 'the shell named alone is a model with no rooms, said');
  ok(roomName('portal:0:1! front')?.kind === 'portal' && (roomName('portal:0:1!') as { window: boolean }).window && (roomName('door:cantina_door.003') as { style: string }).style === 'cantina_door' && (roomName('cell:3') as { name: string }).name === 'room3', "names: a doorway's window mark and a tail, Blender's .003 left out, a cell with no name of its own");
}

// ---------------------------------------------------------------- 5b. how a house collides, room by room; a doorway's first triangle
{
  const refused = (doc: RawGltf, record = TEST_HOUSE_RECORD) => (importModel(sourceOf(doc), record, IMPORT_TUNE) as { refuse?: string[] }).refuse ?? [];
  /** Each room's node in a GLB: how many of its primitives collide as drawn, are a stand-in, or are drawn and never collided. */
  const solidity = (glb: Buffer) => {
    const g = readGlb(glb) as { json: { nodes: { name: string; mesh?: number }[]; meshes: { primitives: { material?: number }[] }[]; materials: { extras?: Record<string, unknown> }[] } };
    const out: Record<number, { solid: number; standIn: number; drawnOnly: number }> = {};
    for (const node of g.json.nodes) {
      const m = /^cell:(\d+):/.exec(node.name);
      if (!m || node.mesh === undefined) continue;
      const r = (out[Number(m[1])] ??= { solid: 0, standIn: 0, drawnOnly: 0 });
      for (const p of g.json.meshes[node.mesh].primitives) {
        const x = g.json.materials[p.material ?? -1]?.extras ?? {};
        if (x.swgColliderOnly) r.standIn++;
        else if (x.swgNoCollide) r.drawnOnly++;
        else r.solid++;
      }
    }
    return out;
  };
  const say = (s: Record<number, { solid: number; standIn: number; drawnOnly: number }>) => Object.entries(s).map(([k, v]) => `${k}: ${v.solid}/${v.standIn}/${v.drawnOnly}`).join(', ');
  const base = solidity(made.glb);
  ok(made.entry.collision === 'triangles' && [0, 1, 2].every((c) => base[c].solid > 0 && !base[c].standIn && !base[c].drawnOnly), `the TEST house, naming no stand-in, collides by every triangle of every room (${say(base)})`);
  // A stand-in for the shell, under no cell (so the shell's): under `auto` the shell collides by it alone, and the rooms,
  // which someone indoors stands in past the shell, keep their own triangles.
  const withPiece = (name: string, cell: string | null, at: number[], half: number[]) => {
    const d = testHouse();
    d.nodes.push({ name, mesh: 0, translation: at, scale: half });
    if (cell) (d.nodes.find((x) => x.name === cell)!.children as number[]).push(d.nodes.length - 1);
    else d.scenes![0].nodes.push(d.nodes.length - 1);
    return d;
  };
  const shellStand = importModel(sourceOf(withPiece('Shell-colonly', null, [0, 1.6, -5], [4, 1.6, 5])), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  const s1 = solidity(shellStand.glb);
  ok(!shellStand.refuse && shellStand.entry.collision === 'by room' && s1[0].standIn === 1 && !s1[0].solid && s1[0].drawnOnly > 0 && [1, 2].every((c) => s1[c].solid > 0 && !s1[c].drawnOnly), `a stand-in for the shell takes the shell alone: the rooms keep their own triangles, so nobody indoors falls through a floor (${say(s1)}; ${shellStand.entry.collision})`);
  ok(shellStand.notes.some((w: string) => /^the shell collides by its own -colonly stand-in alone, the rest by their own triangles/.test(w)), 'and says which collides by its stand-in');
  // A stand-in under the hall takes the hall alone, the shell and the parlour by their own triangles.
  const bench = withPiece('HallBench-colonly', 'cell:1:hall', [2.5, 0.5, -2.5], [0.6, 0.4, 0.3]);
  const hallStand = importModel(sourceOf(bench), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  const s2 = solidity(hallStand.glb);
  ok(!hallStand.refuse && hallStand.entry.collision === 'by room' && s2[1].standIn === 1 && !s2[1].solid && s2[1].drawnOnly > 0 && [0, 2].every((c) => s2[c].solid > 0 && !s2[c].drawnOnly) && hallStand.notes.some((w: string) => /^room 1 \(hall\) collides by its own -colonly stand-in alone/.test(w)), `a stand-in under a room takes that room alone, said (${say(s2)})`);
  // Every room and the shell naming one: `stand-in` whole, as a model with no rooms would be.
  const every = testHouse();
  for (const [name, cell, at] of [['ShellStand-colonly', 'cell:0:shell', [0, 1.6, -5]], ['HallStand-colonly', 'cell:1:hall', [0, 0.05, -2.5]], ['ParlourStand-colonly', 'cell:2:parlour', [0, 0.05, -7.5]]] as [string, string, number[]][]) {
    every.nodes.push({ name, mesh: 0, translation: at, scale: [3.8, 0.05, 2.4] });
    (every.nodes.find((x) => x.name === cell)!.children as number[]).push(every.nodes.length - 1);
  }
  const s3made = importModel(sourceOf(every), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  const s3 = solidity(s3made.glb);
  ok(!s3made.refuse && s3made.entry.collision === 'stand-in' && [0, 1, 2].every((c) => s3[c].standIn === 1 && !s3[c].solid), `every room and the shell naming a stand-in is stand-in whole (${say(s3)})`);
  // A record that leaves a walked room nothing that collides is refused in words: `stand-in` naming none there, and `none`.
  const standIn = (importModel(sourceOf(testHouse()), { ...TEST_HOUSE_RECORD, collision: 'stand-in' }, IMPORT_TUNE) as { refuse?: string[] }).refuse ?? [];
  const none = (importModel(sourceOf(testHouse()), { ...TEST_HOUSE_RECORD, collision: 'none' }, IMPORT_TUNE) as { refuse?: string[] }).refuse ?? [];
  ok(standIn.some((w) => /room 1 \(hall\) has nothing that collides, so someone who walks in falls through its floor/.test(w)) && standIn.some((w) => /room 2 \(parlour\) has nothing that collides/.test(w)), `a house filed stand-in with no stand-in under its rooms is refused in words ("${standIn[0]}")`);
  ok(none.some((w) => /room 1 \(hall\) has nothing that collides/.test(w)), 'and one filed none');
  // A room seen only through a window, nobody walking into it, may have nothing solid.
  const windowed = renamed(withPiece('HallBench-colonly', 'cell:1:hall', [0, 0.05, -2.5], [3.8, 0.05, 2.4]), 'portal:1:2', 'portal:1:2!');
  const w1 = importModel(sourceOf(windowed), { ...TEST_HOUSE_RECORD, collision: 'stand-in' }, IMPORT_TUNE) as typeof made;
  ok(!w1.refuse && w1.notes.some((w: string) => /room 2 \(parlour\) is seen only through a window/.test(w)), `a room behind a window alone with nothing solid is no refusal (${w1.refuse?.[0] ?? 'imported'})`);
  // A room whose every piece is -nocol is refused as well, whatever the record.
  const unsolid = testHouse();
  const pIdx = new Set((unsolid.nodes.find((x) => x.name === 'cell:2:parlour')!.children as number[]));
  unsolid.nodes = unsolid.nodes.map((x, i) => (pIdx.has(i) ? { ...x, name: `${x.name}-nocol` } : x));
  ok(refused(unsolid).some((w) => /room 2 \(parlour\) has nothing that collides/.test(w)), 'a room whose every piece is -nocol is refused');

  // A doorway drawn with a fifth corner on its bottom edge and its first triangle along that edge: the game reads a doorway's
  // plane off its first triangle alone, so the triangle of no area is left out and the doorway keeps a plane.
  const F = H.front;
  const mid = (F.y0 + F.y1) / 2;
  const five = [[-F.x, F.y0 - mid, 0], [F.x, F.y0 - mid, 0], [F.x, F.y1 - mid, 0], [-F.x, F.y1 - mid, 0], [0, F.y0 - mid, 0]];
  const withFront = (indices: number[]) => {
    const d = testHouse();
    d.meshes[3] = { name: 'Doorway', primitives: [{ positions: five.flat(), indices }] };
    return importModel(sourceOf(d), TEST_HOUSE_RECORD, IMPORT_TUNE) as typeof made;
  };
  const firstNormal = (g: { v: number[][]; i: number[] }) => {
    const [a, b, c] = [g.v[g.i[0]], g.v[g.i[1]], g.v[g.i[2]]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  };
  const sliver = withFront([0, 4, 1, 4, 2, 3, 4, 1, 2, 0, 4, 3]);
  const sp = sliver.def.portals[0] as { v: number[][]; i: number[] };
  const sn = firstNormal(sp);
  ok(!sliver.refuse && sp.i.length === 9 && Math.abs(sn[2]) > 1 && close(sn[0], 0) && close(sn[1], 0) && sliver.notes.some((w: string) => /1 doorway triangle\(s\) of no area \(three corners in a row\) left out/.test(w)), `a doorway's triangle of no area is left out, said, and its first triangle faces through the doorway (${sn.map((x) => x.toFixed(3)).join(' ')})`);
  const order = withFront([4, 1, 2, 4, 2, 3, 0, 4, 3]);
  const op = order.def.portals[0] as { i: number[] };
  ok(!order.refuse && op.i.join() === '4,2,3,4,1,2,0,4,3' && !order.notes.some((w: string) => /of no area/.test(w)), `a doorway's largest triangle is written first, the rest in their order (${op.i.join(',')})`);
  ok((made.def.portals as { i: number[] }[]).every((g) => g.i.join() === '0,1,2,0,2,3'), 'a quad of two equal triangles keeps the order Blender drew it in');
}

// ---------------------------------------------------------------- 6. the folder's files, and a fresh record
{
  const out = join(tmp, 'folder');
  const hut = importModel(sourceOf(testHut()), TEST_HUT_RECORD, IMPORT_TUNE) as typeof made;
  writeImport(out, hut, 1000);
  ok(!existsSync(join(out, 'floors.json')) && !existsSync(join(out, 'doors.json')), 'a folder of no house writes neither floors.json nor doors.json');
  writeImport(out, made, 2000);
  const floors = JSON.parse(readFileSync(join(out, 'floors.json'), 'utf8'));
  const doors = JSON.parse(readFileSync(join(out, 'doors.json'), 'utf8'));
  ok(floors.version === 1 && floors.mesh === true && Object.keys(floors.models).join() === 'test_house' && floors.models.test_house['1'].floor.stride === 3, "floors.json in the converter's own shape, the house's floors by room");
  ok(doors.version === 1 && JSON.stringify(doors.styles) === '{}' && doors.models.test_house.length === 1 && doors.models.test_house[0].style === H.doorStyle, "doors.json with its rows by style name and no style's numbers");
  ok(!/"move"|"open"|"trigger"|"sounds"/.test(readFileSync(join(out, 'doors.json'), 'utf8')), 'not one of a door style\'s numbers is written');
  ok(dropImport(out, 'test_house', 3000) && !existsSync(join(out, 'floors.json')) && !existsSync(join(out, 'doors.json')), 'the house taken out takes both files with it');
  // The command on a source naming rooms with no record beside it: the record it writes says building, and the house is made.
  const repo = join(tmp, 'repo');
  const src = join(tmp, 'fresh');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'my_house.glb'), writeRawGlb(testHouse()));
  const log: string[] = [];
  const code = runImport({ input: join(src, 'my_house.glb'), out: join(tmp, 'fresh-out'), repo, log: (s: string) => log.push(s), now: 4000 });
  const rec = JSON.parse(readFileSync(join(src, 'my_house.import.json'), 'utf8'));
  ok(code === 0 && rec.kind === 'building' && log.some((s) => /2 rooms and 1 door/.test(s)), `a fresh record of a source naming rooms says building, and the run says its rooms (${log.find((s) => /2 rooms and 1 door/.test(s))?.replace(/^.*?(\d+ triangles drawn)/, '$1')})`);
  ok(log.some((s) => /--cell-pad= --portal-flat= --door-reach= --light-reach= --light-scale=/.test(s)), 'and the run prints the rooms\' flags');
}

// ---------------------------------------------------------------- 7. day one: a model naming no room, byte for byte as 441c2f6 imports it
{
  const BEFORE_WAVE = '441c2f6';
  /** What 441c2f6's pass made of the TEST hut, the TEST plate and a lit hut (each GLB's and picture's SHA-1, its two entries), SHA-1, sixteen hex. */
  const BEFORE_WAVE_DIGEST = 'b1e4805b3981d8a2';
  const lamp = (): RawGltf => {
    const doc = testHut();
    doc.nodes.push({ name: 'Lamp', translation: [0, 2.5, -3], extensions: { KHR_lights_punctual: { light: 0 } } });
    doc.extensions = { KHR_lights_punctual: { lights: [{ type: 'point', intensity: 10 }] } };
    doc.extensionsUsed = ['KHR_lights_punctual'];
    return doc;
  };
  const sources = [
    { name: 'hut', doc: testHut(), record: TEST_HUT_RECORD },
    { name: 'plate', doc: testPlate(), record: TEST_PLATE_RECORD },
    { name: 'lit', doc: lamp(), record: { ...TEST_HUT_RECORD, id: 'test_lit' } },
  ];
  /** The one note this wave rewords for a model with no rooms (its lights' words named this wave's rooms as the next one's). */
  const OLD_LIGHT = 'light(s) left out: a placed thing adds no light to the world (a house\'s lamps are the next wave\'s)';
  const NEW_LIGHT = 'light(s) left out: a placed thing adds no light to the world (a house\'s lamps light its rooms: name them cell:<n>:<name>)';
  const sha = (b: Buffer | string | null) => (b === null ? 'none' : createHash('sha1').update(b).digest('hex'));
  const digestOf = (list: { glb: Buffer; picture: Buffer | null; def: unknown; entry: Record<string, unknown> }[]) =>
    createHash('sha1')
      .update(JSON.stringify(list.map((m) => [sha(m.glb), sha(m.picture), m.def, { ...m.entry, notes: (m.entry.notes as string[]).map((w) => w.replace(NEW_LIGHT, OLD_LIGHT)) }])))
      .digest('hex')
      .slice(0, 16);
  // One source file each, read afresh for each pass (the record's `source` is its file's name).
  const files = sources.map((s) => {
    const file = join(tmp, `day1-${s.name}.glb`);
    writeFileSync(file, writeRawGlb(s.doc));
    return file;
  });
  const now = sources.map((s, i) => importModel(readSource(files[i]), s.record, IMPORT_TUNE) as typeof made);
  ok(now.every((m) => !m.refuse && !m.def.cells && !m.floors && !m.doors && m.entry.rooms === undefined), 'today a model naming no room is made with no cells, floors, doors or rooms');
  ok(now[2].notes.some((w: string) => w.endsWith(NEW_LIGHT)), 'a model with no rooms still leaves its lights out, in words that now say where a lamp goes');
  const digest = digestOf(now);
  const old = await loadOld<{ importModel: typeof importModel; IMPORT_TUNE: typeof IMPORT_TUNE; writeImport: typeof writeImport }>(['tools/swg/imports.mjs'], 'tools/swg/imports.mjs', BEFORE_WAVE);
  if (old) {
    const then = sources.map((s, i) => old.importModel(readSource(files[i]), s.record, old.IMPORT_TUNE) as typeof made);
    for (let i = 0; i < sources.length; i++) {
      const a = now[i];
      const b = then[i];
      ok(a.glb.equals(b.glb) && sha(a.picture) === sha(b.picture), `${sources[i].name}: the GLB and its picture byte for byte as ${BEFORE_WAVE}'s pass makes them (${a.def.file})`);
      ok(JSON.stringify(a.def) === JSON.stringify(b.def) && JSON.stringify(a.cards) === JSON.stringify(b.cards) && JSON.stringify(a.collision) === JSON.stringify(b.collision), `${sources[i].name}: its manifest entry, cards and shapes as ${BEFORE_WAVE}'s`);
      const notes = (a.entry.notes as string[]).map((w) => w.replace(NEW_LIGHT, OLD_LIGHT));
      ok(JSON.stringify({ ...a.entry, notes }) === JSON.stringify(b.entry), `${sources[i].name}: its library entry as ${BEFORE_WAVE}'s, its one reworded note aside`);
    }
    // Two folders, the hut and the plate written into each by each pass: every file byte for byte.
    const fa = join(tmp, 'day1-now');
    const fb = join(tmp, 'day1-then');
    writeImport(fa, now[0], 5000);
    writeImport(fa, now[1], 5000);
    old.writeImport(fb, then[0], 5000);
    old.writeImport(fb, then[1], 5000);
    const list = (d: string): string[] => readdirSync(d, { recursive: true }).map(String).sort();
    const listed = list(fa);
    ok(listed.join() === list(fb).join() && listed.every((f) => statSync(join(fa, f)).isDirectory() || readFileSync(join(fa, f)).equals(readFileSync(join(fb, f)))), `a folder of the two written by each pass is the same files byte for byte (${listed.join(', ')})`);
    ok(digestOf(then) === digest, `and what ${BEFORE_WAVE}'s pass made is what today's makes (${digestOf(then)})`);
    console.log(`note: ${BEFORE_WAVE}'s digest ${digestOf(then)}`);
  } else console.log(`note: git cannot hand ${BEFORE_WAVE}'s imports.mjs over here; held to the answer recorded from it`);
  ok(digest === BEFORE_WAVE_DIGEST, `today's pass makes of a model naming no room what ${BEFORE_WAVE}'s made (held to the answer recorded from it, ${BEFORE_WAVE_DIGEST}; today ${digest})`);
}

rmSync(tmp, { recursive: true, force: true });
console.log(`importRooms: ${checks} checks passed`);
