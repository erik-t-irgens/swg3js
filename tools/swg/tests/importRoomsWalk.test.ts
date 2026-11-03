// A house of the owner's own with rooms (Map-maker II's eleventh wave), made by the import pass out of the TEST house
// (`blenderGlb.ts`, nothing of the game's), read through the game's own `AssetPack` from a folder (three's own GLTFLoader
// under it, the network and the image decoder stood in) and stood through the real streamer and the real physics
// (`streamHarness.ts`) as a permanent row of it is:
//
//   1. the folder reads as the game reads it: its cells and doorways on the model, its floors laid on its rooms, its doors
//      table, and a room's stand-in collider in its room;
//   2. `trackCell` walks a body in from the street through the front doorway into the hall, through the inner one into the
//      parlour, and back out;
//   3. `PortalVisibility` floods the hall from the front doorway seen from the street, and from inside the hall sees the
//      street through it and not the parlour behind;
//   4. the room pool hands the hall its lights (`roomLightPlan`, the rule the world lights a room by): its own lamp first at
//      its own range, then the parlour's, its own fill on the ambient, every lamp standing in its room;
//   5. the real `Doors` stands its door with the style's numbers out of a gallery stand-in (`galleryDoorStyles`, the very
//      ask the world makes), shut and solid, opening for a body at it; and with no gallery the doorway stands open; a
//      building's own styles kept over the gallery's and the gallery never asked where its own table names them all, and a
//      gallery that answered nothing asked again;
//   6. a point in a room under a lake of ours is dry to `waterTopAt`, and one beside the house is wet;
//   7. a row of it takes no scale; and the hand-overs only the game makes, as text;
//   8. the room pool's rule moved out of the world, held to 441c2f6's own lines (out of git) over the TEST house, a busy
//      building and the gallery's, Tatooine's and Naboo's buildings where those packs are here, and to a digest recorded
//      from those lines over the two that need no pack, asserted whether or not git answers;
//   9. a house under `auto` with a stand-in for its shell and a doorway whose first triangle has no area: a body walks in
//      through that doorway, and the indoor filter's ray meets each room's own floor.
//
// Run: node tools/swg/tests/importRoomsWalk.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeStreamer, THREE, type Harness } from './streamHarness.ts';
import { IMPORT_TUNE, importModel, readSource, writeImport } from '../imports.mjs';
import { TEST_HOUSE, TEST_HOUSE_RECORD, cube, testHouse, writeRawGlb } from './blenderGlb.ts';

const { AssetPack } = await import('../../../src/world/assetPack.ts');
const { dressingStandOf } = await import('../../../src/world/permanent.ts');
const { toGame } = await import('../../../src/story/placements.ts');
const { Doors, galleryDoorStyles } = await import('../../../src/world/doors.ts');
const { OPENER, doorStylesFor } = await import('../../../src/world/doorMath.ts');
const { PortalVisibility, PORTAL_CULL } = await import('../../../src/world/portalVis.ts');
const { roomLightPlan } = await import('../../../src/world/roomLights.ts');
const { roomsReport } = await import('../../../src/world/importedRooms.ts');
const { waterTopAt } = await import('../../../src/world/waterLineMath.ts');
const { RAPIER, Group, groups } = await import('../../../src/core/physics.ts');

let checks = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
}
const close = (a: number, b: number, e = 1e-4) => Math.abs(a - b) < e;
const H = TEST_HOUSE;

// ---- The house made, and a site serving its folder, the shared door models and a gallery's door styles ----
const tmp = mkdtempSync(join(tmpdir(), 'swg-rooms-walk-'));
const src = join(tmp, 'test_house.glb');
// The TEST house with a room's stand-in beside it: a bench under the hall that collides and is drawn nowhere (its collision
// rule `triangles`, so the house's own walls collide as the TEST house's do).
const doc = testHouse();
doc.nodes.push({ name: 'HallBench-colonly', mesh: 0, translation: [2.5, 0.5, -2.5], scale: [0.6, 0.4, 0.3] });
(doc.nodes.find((x) => x.name === 'cell:1:hall')!.children as number[]).push(doc.nodes.length - 1);
writeFileSync(src, writeRawGlb(doc));
const made = importModel(readSource(src), { ...TEST_HOUSE_RECORD, collision: 'triangles' }, IMPORT_TUNE) as { refuse?: string[]; def: { file: string } };
assert.ok(!made.refuse, `the TEST house imports (${made.refuse?.join('; ')})`);
/** Two sites: one with the player's own gallery (its door styles) and the shared door models, one with neither. */
const SITE = 'http://rooms.test/';
const BARE = 'http://bare.test/';
const roots = { [SITE]: join(tmp, 'site'), [BARE]: join(tmp, 'bare') };
for (const r of Object.values(roots)) writeImport(join(r, 'imports-private'), made as never, 1000);
// The style's numbers, as the gallery's own doors.json carries the client's (a test's own here: a leaf of its own sliding
// 1.3 m to its side in a third of a second, opening for a body within 3 m).
const STYLE = { door: 'test_leaf', door2: null, flip2: false, frame: null, move: [1.3, 0, 0], open: 0.3, close: 0.3, spring: 1, smooth: 1, trigger: 3, sounds: {} };
mkdirSync(join(roots[SITE], 'assets-private', 'gallery'), { recursive: true });
writeFileSync(join(roots[SITE], 'assets-private', 'gallery', 'doors.json'), JSON.stringify({ version: 1, styles: { [H.doorStyle]: STYLE }, models: {} }));
// The shared door models, on both sites (so the bare one lacks the gallery's styles alone): the test's own leaf, 1.2 m wide
// and 2.1 m high, its origin at its bottom middle.
for (const r of Object.values(roots)) {
  mkdirSync(join(r, 'assets-private', 'doors'), { recursive: true });
  writeFileSync(join(r, 'assets-private', 'doors', 'test_leaf.glb'), writeRawGlb({ meshes: [{ name: 'Leaf', primitives: [cube(0)] }], materials: [{ name: 'leaf' }], nodes: [{ name: 'Leaf', mesh: 0, translation: [0, 1.05, 0], scale: [0.6, 1.05, 0.03] }] }));
  writeFileSync(join(r, 'assets-private', 'doors', 'manifest.json'), JSON.stringify({ version: 1, planet: 'doors', categories: { doors: [{ id: 'test_leaf', file: 'test_leaf.glb', bounds: { min: [-0.6, 0, -0.03], max: [0.6, 2.1, 0.03] }, triangles: 12 }] } }));
}

const realFetch = globalThis.fetch;
const g = globalThis as unknown as { self?: unknown; createImageBitmap?: unknown; ProgressEvent?: unknown };
const hadSelf = 'self' in g;
const hadProgress = 'ProgressEvent' in g;
const realBitmap = g.createImageBitmap;
g.self ??= globalThis;
g.ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) {
    super(type);
    Object.assign(this, init);
  }
};
g.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const served: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  if (url.startsWith('blob:')) return realFetch(input as RequestInfo, init);
  served.push(url);
  const site = Object.keys(roots).find((s) => url.startsWith(s));
  const file = site ? join(roots[site], ...url.slice(site.length).split('?')[0].split('/')) : '';
  if (!file || !existsSync(file)) return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
  const type = file.endsWith('.json') ? 'application/json' : file.endsWith('.glb') ? 'model/gltf-binary' : 'image/png';
  return new Response(readFileSync(file), { status: 200, headers: { 'content-type': type } });
}) as typeof fetch;

/** The row as the world editor writes it: the house at raw (-60, 0, 40), unturned, so the game's (60, 0, 40). */
const AT = { x: 60, z: 40 };
const ROW = { id: 'house-1', kind: 'building' as const, pack: 'imported' as const, model: TEST_HOUSE_RECORD.id, x: -AT.x, y: 0, z: AT.z, q: [1, 0, 0, 0] as [number, number, number, number] };

/** A streamer with the house stood out of `site`'s imports folder, its doors stood by a real `Doors`, settled beside it. */
async function standHouse(site: string, row: Record<string, unknown> = ROW): Promise<{ h: Harness; pack: InstanceType<typeof AssetPack>; doors: InstanceType<typeof Doors>; b: any }> {
  const pack = await AssetPack.load('imported', site, { dir: 'imports-private/' });
  assert.ok(pack, 'the folder loads');
  const h = await makeStreamer();
  const doors = new Doors(h.scene, h.physics, site);
  doors.moreStyles = () => galleryDoorStyles(site);
  h.stream.doorHost = doors;
  const gp = toGame(row as never, { x: 0, z: 0 }, 'raw');
  const s = dressingStandOf(row as never, gp, `place/${row.id}`, () => null, () => false);
  assert.ok(s && s.imported === true, "an imported building row's stand says so");
  const answer = h.stream.standPermanent(s!, pack as never);
  assert.ok(answer, 'the row is filed');
  await h.settle(AT, 30);
  await answer!.built;
  await h.settle(AT, 30);
  const b = [...h.s.buildings].find((x: { model: { def: { id: string } } }) => x.model.def.id === row.model);
  assert.ok(b, 'the house is a building of the streamer');
  return { h, pack: pack!, doors, b };
}

try {
  const { h, pack, doors, b } = await standHouse(SITE);

  // ---------------------------------------------------------------- 1. as the game reads the folder
  {
    const def = pack.find(TEST_HOUSE_RECORD.id)!;
    ok(def.cells?.length === 3 && def.portals?.length === 2 && !!def.cells[1].floor && !!def.cells[2].floor && !def.cells[0].floor, "the game's own pack loader reads the house's cells, its doorways and its rooms' floors (floors.json laid on its cells)");
    ok(!!pack.doors && pack.doors.models[TEST_HOUSE_RECORD.id]?.length === 1 && Object.keys(pack.doors.styles).length === 0, 'and its doors table: one door, no style of its own');
    ok(served.includes(`${SITE}imports-private/floors.json`) && served.includes(`${SITE}imports-private/doors.json`), 'both asked beside its manifest');
    const model = b.model;
    const cells = new Set(model.primitives.map((p: { cell: number }) => p.cell));
    ok([0, 1, 2].every((c) => cells.has(c)) && model.interiorBoxes.length === 2 && model.portals.length === 2 && model.portals.every((p: { links: unknown[] }) => p.links.length === 2), `its primitives in their rooms (${[...cells].sort().join(', ')}), two room boxes, each doorway joining its two rooms both ways`);
    const standIns = (model.colliderOnly ?? []) as { cell: number }[];
    ok(standIns.length === 1 && standIns[0].cell === 1, `a room's stand-in is in its room, solid to someone indoors (${standIns.map((s) => s.cell).join(', ') || 'none'})`);
    const report = roomsReport(def, pack.doors, await galleryDoorStyles(SITE))!;
    ok(report.rooms[1].floor?.triangles === 4 && report.rooms[1].floor.openEdges === 6 && report.rooms[1].points[0].range === H.hallLamp.range && report.doors[0].found === 'gallery', `the console's report reads it the same way (the hall's floor four triangles, its lamp ${report.rooms[1].points[0].range} m, its door's style the gallery's)`);
    // Where a style is found, in the doors' own order: the building's own table first, then the gallery's, else nowhere.
    const ownToo = roomsReport(def, { ...pack.doors!, styles: { [H.doorStyle]: STYLE } as never }, await galleryDoorStyles(SITE))!;
    const nowhere = roomsReport(def, pack.doors, null)!;
    ok(ownToo.doors[0].found === 'own' && nowhere.doors[0].found === 'none', `a style its own table names is its own though the gallery names it too, and one neither names is none (${ownToo.doors[0].found}, ${nowhere.doors[0].found})`);
  }

  // ---------------------------------------------------------------- 2. walked in and out
  {
    const prev = new THREE.Vector3();
    const pos = new THREE.Vector3();
    let state = null as ReturnType<typeof h.stream.trackCell>;
    const seen: string[] = [];
    const walk = (z0: number, z1: number) => {
      const step = z1 > z0 ? 0.2 : -0.2;
      for (let z = z0; step > 0 ? z < z1 : z > z1; z += step) {
        prev.set(AT.x, 0.1, z);
        pos.set(AT.x, 0.1, z + step);
        state = h.stream.trackCell(state, prev, pos);
        const now = state ? `${state.cell}` : 'out';
        if (seen[seen.length - 1] !== now) seen.push(now);
      }
    };
    walk(AT.z + 3, AT.z - 7.5);
    ok(seen.join(' ') === 'out 1 2' && state?.building === b, `walked in from the street: outside, through the front doorway into the hall, through the inner one into the parlour (${seen.join(' > ')})`);
    walk(AT.z - 7.5, AT.z + 3);
    ok(seen.join(' ') === 'out 1 2 1 out' && state === null, `and back out the way it came (${seen.join(' > ')})`);
  }

  // ---------------------------------------------------------------- 3. what a camera sees through the doorways
  {
    const vis = new PortalVisibility({ ...PORTAL_CULL, on: true, mode: 'rooms' });
    const W = 1920;
    const HT = 1080;
    const camera = new THREE.PerspectiveCamera(60, W / HT, 0.05, 9000);
    const look = (from: number[], to: number[]) => {
      camera.position.set(from[0], from[1], from[2]);
      camera.up.set(0, 1, 0);
      camera.lookAt(to[0], to[1], to[2]);
      camera.updateMatrixWorld(true);
    };
    look([AT.x, 1.6, AT.z + 6], [AT.x, 1.2, AT.z]);
    vis.compute(camera, null, 0, [b], 1, W, HT);
    const fromStreet = vis.seenOf(b);
    ok(!!fromStreet && fromStreet[1] === 1, 'from the street the flood reaches the hall through the front doorway');
    look([AT.x, 1.6, AT.z - 3], [AT.x, 1.2, AT.z + 6]);
    const res = vis.compute(camera, b, 1, [], 0, W, HT);
    const inside = vis.seenOf(b);
    ok(res.worldSeen && !!inside && inside[1] === 1 && inside[2] !== 1, 'from inside the hall facing the street: the street through the front doorway, and not the parlour behind');
    look([AT.x, 1.6, AT.z - 1], [AT.x, 1.2, AT.z - 9]);
    vis.compute(camera, b, 1, [], 0, W, HT);
    ok(vis.seenOf(b)?.[2] === 1, 'and facing the parlour, the parlour through the inner doorway');
  }

  // ---------------------------------------------------------------- 4. the room pool's lights
  {
    const plan = roomLightPlan(b.model.def.cells, 1, 0.18)!;
    ok(plan.points.length === 2 && plan.points[0].cell === 1 && plan.points[0].range === H.hallLamp.range && plan.points[1].cell === 2 && plan.points[1].range === IMPORT_TUNE.lightReach, `standing in the hall, the pool lights the hall's lamp first at its own ${plan.points[0].range} m, then the parlour's through their doorway at ${plan.points[1].range} m`);
    ok(close(plan.ambient[0], 0.18 + H.hallAmbient[0]) && close(plan.ambient[2], 0.18 + H.hallAmbient[2]) && plan.parallel === null, "its own fill on the pool's ambient, and no parallel light");
    const v = new THREE.Vector3();
    const lamp = (p: { light: { position: number[] } }) => v.set(p.light.position[0], p.light.position[1], p.light.position[2]).applyMatrix4(b.matrix);
    ok(h.stream.cellAt(b, lamp(plan.points[0])) === 1 && h.stream.cellAt(b, lamp(plan.points[1])) === 2, 'each lamp stands in its own room as the world places it');
    const parlour = roomLightPlan(b.model.def.cells, 2, 0.18)!;
    ok(parlour.points[0].cell === 2 && parlour.points[1].cell === 1 && close(parlour.ambient[0], 0.18 + H.hallAmbient[0]), "standing in the parlour, its own lamp first, then the hall's, and the hall's fill with it");
  }

  // ---------------------------------------------------------------- 5. the door, by the gallery's style, and none without one
  {
    // The rooms (and their doors) are made a moment after the building stands; a step of the doors stands each where the
    // bodies near it say.
    const st = doors.status();
    ok(st.buildings === 1 && st.doors === 1 && st.ready === 1 && st.bodies === 1, `a real Doors stands the house's door, its style's numbers out of the gallery stand-in (${JSON.stringify({ doors: st.doors, ready: st.ready, bodies: st.bodies, models: st.models })})`);
    const ray = new RAPIER.Ray({ x: AT.x, y: 1, z: AT.z + 3 }, { x: 0, y: 0, z: -1 });
    const hitAt = () => {
      const hit = h.physics.world.castRay(ray, 20, true);
      return hit ? AT.z + 3 - hit.timeOfImpact : null;
    };
    doors.beginOpeners();
    doors.step(1 / 60);
    h.physics.stepOnce();
    const shut = hitAt();
    ok(shut !== null && Math.abs(shut - AT.z) < 0.2 && doors.openShare(b, 0) === 0, `shut with nobody near, its leaf stops a ray down the doorway (at z ${shut?.toFixed(2)})`);
    for (let i = 0; i < 40; i++) {
      doors.beginOpeners();
      doors.addOpener(AT.x, 0.1, AT.z + 1.5, OPENER.player);
      doors.step(1 / 60);
      h.physics.stepOnce();
    }
    const open = hitAt();
    ok(doors.openShare(b, 0) === 1 && (open === null || open < AT.z - 1), `a body at it opens it, and the ray passes into the house (${open === null ? 'nothing' : `z ${open.toFixed(2)}`})`);
    const bare = await standHouse(BARE);
    const st2 = bare.doors.status();
    bare.h.physics.stepOnce();
    ray.origin = { x: AT.x, y: 1, z: AT.z + 3 };
    const through = bare.h.physics.world.castRay(ray, 20, true);
    ok(st2.buildings === 1 && st2.doors === 0 && (!through || AT.z + 3 - through.timeOfImpact < AT.z - 1), `with no gallery (the door models there) the door's style is known nowhere: no door stands and the doorway is open (${st2.buildings} building, ${st2.doors} doors)`);
    ok(served.includes(`${BARE}assets-private/gallery/doors.json`) && !served.includes(`${BARE}assets-private/gallery/manifest.json`), "the gallery's door styles asked of its doors.json alone, never its manifest");
    // Where the styles come from, as `doorStylesFor` decides it: a building whose own table names every row's style asks
    // nothing (every converted pack's), and one that lacks a style takes the gallery's with its own laid over them.
    let asked = 0;
    const own = { a: { tag: 'own' } } as unknown as Record<string, never>;
    const more = async () => {
      asked++;
      return { a: { tag: 'gallery' }, b: { tag: 'gallery' } } as unknown as Record<string, never>;
    };
    const mine = await doorStylesFor([{ style: 'a' }] as never, own, more);
    ok(mine === own && asked === 0, "a building whose own table names every style asks the gallery nothing");
    const both = (await doorStylesFor([{ style: 'a' }, { style: 'b' }] as never, own, more)) as unknown as Record<string, { tag: string }>;
    ok(asked === 1 && both.a.tag === 'own' && both.b.tag === 'gallery', "one that lacks a style takes the gallery's, its own table's styles kept over the gallery's");
    // A gallery that answered nothing is asked again the next time, and one that answered is kept.
    const fresh = new Doors(h.scene, h.physics, SITE);
    let calls = 0;
    fresh.moreStyles = async () => (++calls === 1 ? null : { [H.doorStyle]: STYLE } as never);
    const ask = (fresh as unknown as { more: () => Promise<unknown> }).more;
    const first = await ask();
    await new Promise((r) => setTimeout(r, 0));
    const second = await ask();
    const third = await ask();
    ok(first === null && !!second && third === second && calls === 2, `a gallery that answered nothing is asked again, and one that answered is kept (${calls} asks)`);
  }

  // ---------------------------------------------------------------- 6. under a lake of ours
  {
    const surface = 6; // a lake's surface three metres over the house's roof
    const v = new THREE.Vector3();
    const indoors = (x: number, y: number, z: number) => h.stream.indoorsAt(v.set(x, y, z));
    const inHall = [AT.x + H.inHall[0], H.inHall[1], AT.z + H.inHall[2]];
    ok(waterTopAt(inHall[0], inHall[1], inHall[2], surface, indoors) === -Infinity, 'a point in the hall under a lake of ours is dry');
    ok(waterTopAt(AT.x + 8, 1, AT.z - 5, surface, indoors) === surface, 'and one beside the house is under the lake');
  }

  // ---------------------------------------------------------------- 7. no scale, and the game's hand-overs
  {
    const scaled = await standHouse(SITE, { ...ROW, id: 'house-2', scale: 2 });
    ok(!!scaled.b && Math.abs(scaled.b.matrix.elements[0] - 1) < 1e-9 && Math.abs(scaled.b.matrix.elements[5] - 1) < 1e-9, 'a row of it with a scale stands at its true size: a house with rooms takes no scale');
    const text = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
    ok(/this\.doors\.moreStyles = \(\) => galleryDoorStyles\(\);/.test(text('src/world/world.ts')), "the world hands its doors the player's own gallery's styles");
    // Since the wave of the rooms' lights the world plans by `planRoomLights`, the same rule with the lights files' edits laid
    // on it: with none it answers the very plan this test reads, in every room of every converted building (roomLights.test).
    ok(/const plan = planRoomLights\(cells, want\.cell, ROOM_LIGHT_TUNE\.ambientFloor, this\.roomPool\.shape, edits \?\? undefined\);/.test(text('src/world/world.ts')) && /const cells = b\.model\.def\.cells \?\? \[\];/.test(text('src/world/world.ts')), 'the world lights a room by the very plan this test reads (with no lights file, `planRoomLights` is `roomLightPlan`)');
    ok(/const styles = await doorStylesFor\(rows, own, this\.moreStyles \? this\.more : null\);/.test(text('src/world/doors.ts')), "the doors look a style up through `doorStylesFor`");
    ok(/const report = roomsReport\(def, pack\.doors, await galleryDoorStyles\(\)\);/.test(text('src/main.ts')), "the console's report reads the house as this test does");
    await scaled.h.settle(AT, 1);
  }

  // ---------------------------------------------------------------- 8. the room pool's rule, moved out of the world as it stood
  {
    // 441c2f6's own lines of `World.updateInteriorLights` (out of git) and today's (the world's own text, which calls
    // `roomLightPlan`), each run as the world runs it over a pool of three's own lights, for every room of the TEST house, of
    // a building of many lights (more than the pool, two parallels, a room two doorways open on twice) and of the gallery's,
    // Tatooine's and Naboo's buildings where those packs are here: every light of the pool, the lit cells, the parallel and
    // the ambient, to the bit. Where git cannot hand the old lines over, today's are held to a digest recorded from them over
    // the TEST house and the busy building, which need no pack; it is asserted whether or not git answers, so a recorded
    // digest cannot go stale unseen.
    const BEFORE_WAVE = '441c2f6';
    /** What 441c2f6's own lines leave in the pool for every room of the TEST house (with its bench) and the busy building: SHA-1 of each room's reading, sixteen hex. */
    const BEFORE_WAVE_LIGHTS = 'aab1f34033d3d0c0';
    const span = (text: string, from: string, to: string) => {
      const a = text.indexOf(from);
      const b = text.indexOf(to, a);
      assert.ok(a >= 0 && b > a, `the lines from "${from}" are in the text`);
      return text.slice(a, b + to.length);
    };
    const END = 'this.interiorAmbient.intensity = INTERIOR_AMBIENT_SCALE;';
    const today = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const { oldTexts } = await import('./oldModules.ts');
    const before = oldTexts(['src/world/world.ts'], BEFORE_WAVE)?.get('src/world/world.ts') ?? null;
    // The lines as a function of what they read off the world (`this.` the pool's own record). Both are plain script with no
    // type in them; one written in should be kept out of these lines, or this reads it as the syntax error it is to script.
    const run = (body: string) => new Function(`function lines(want, THREE, self, INTERIOR_LIGHT_CAP, INTERIOR_LIGHT_SCALE, INTERIOR_AMBIENT_FLOOR, INTERIOR_AMBIENT_SCALE, roomLightPlan) {\n${body.replace(/\bthis\./g, 'self.')}\n}\nreturn lines;`)() as (...a: unknown[]) => void;
    const constant = (text: string, name: string) => Number(new RegExp(`const ${name} = ([\\d.]+);`).exec(text)?.[1]);
    // Since the wave of the rooms' lights the world plans by `planRoomLights` and puts the plan on its pool
    // (`RoomLightPool.apply`, its dials the numbers it held fixed). Today's lines are the world's own text, from the room
    // chosen to the pool stepped, run as script over the very lights with the world's other parts answering as a world with
    // no lights file and nothing hung on a row does (roomLights.test holds them to 0e2e226's own lines over every converted
    // building as well).
    const { planRoomLights, ROOM_LIGHT_TUNE } = await import('../../../src/world/roomLights.ts');
    const { RoomLightPool } = await import('../../../src/world/roomLightPool.ts');
    ok(/const plan = planRoomLights\(cells, want\.cell, ROOM_LIGHT_TUNE\.ambientFloor, this\.roomPool\.shape, edits \?\? undefined\);/.test(today) && /this\.roomPool\.apply\(plan, b\.matrix, this\.fxLampCells\);/.test(today), "the world's own lines are the wave's plan put on its pool");
    const todayLines = new Function('state', 'self', 'planRoomLights', 'ROOM_LIGHT_TUNE', span(today, 'const want = state && state.cell > 0 ? { building: state.building, cell: state.cell } : null;', 'if (this.roomPool.needsStep) this.stepRoomLights();').replace(/\bthis\./g, 'self.')) as (state: unknown, self: unknown, plan: unknown, tune: unknown) => void;
    const nowBody = ((want: { building: unknown; cell: number }, _three: unknown, p: { interiorPoints: THREE.PointLight[]; fxLampCells: number[]; interiorParallel: THREE.DirectionalLight; interiorAmbient: THREE.AmbientLight }) => {
      const self = {
        roomPool: new RoomLightPool(p.interiorPoints, p.interiorParallel, p.interiorAmbient),
        fxLampCells: p.fxLampCells,
        portals: null,
        interiorLightsFor: null,
        roomPlan: null,
        roomPlanStaleRows: [],
        roomPlanVersion: 0,
        roomLightEdits: { empty: true },
        attachedLightsIn: () => [],
        copyKeyOf: () => null,
        rowAttach: { matrixOf: () => null },
        stepRoomLights: () => {},
      };
      todayLines(want, self, planRoomLights, ROOM_LIGHT_TUNE);
    }) as unknown as (...a: unknown[]) => void;
    const { INTERIOR_LIGHT_CAP } = await import('../../../src/world/roomLights.ts');
    const pool = () => ({
      interiorPoints: Array.from({ length: INTERIOR_LIGHT_CAP }, () => new THREE.PointLight(0xffffff, 0, 1, 2)),
      fxLampCells: new Array(INTERIOR_LIGHT_CAP).fill(-1),
      interiorParallel: new THREE.DirectionalLight(0xffffff, 0),
      interiorAmbient: new THREE.AmbientLight(0xffffff, 0),
    });
    type Pool = ReturnType<typeof pool>;
    const read = (p: Pool) => [
      ...p.interiorPoints.flatMap((l) => [l.color.r, l.color.g, l.color.b, l.intensity, l.distance, l.position.x, l.position.y, l.position.z]),
      ...p.fxLampCells,
      p.interiorParallel.color.r, p.interiorParallel.color.g, p.interiorParallel.color.b, p.interiorParallel.intensity,
      p.interiorParallel.position.x, p.interiorParallel.position.y, p.interiorParallel.position.z, p.interiorParallel.target.position.x, p.interiorParallel.target.position.z,
      p.interiorAmbient.color.r, p.interiorAmbient.color.g, p.interiorAmbient.color.b, p.interiorAmbient.intensity,
    ];
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(123.25, 4.5, -987.75), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7), new THREE.Vector3(1, 1, 1));
    const L = (type: number, color: number[], position: number[], attenuation: number[] = [1, 0, 0]) => ({ type, color, position, direction: [0.3, -0.9, 0.1], attenuation });
    const busy = {
      id: 'busy',
      cells: [
        { index: 0, name: 'out', portals: [{ geometry: 0, target: 1, passable: true }] },
        { index: 1, name: 'a', portals: [{ geometry: 0, target: 0, passable: true }, { geometry: 1, target: 2, passable: true }, { geometry: 2, target: 2, passable: true }, { geometry: 3, target: 3, passable: true }], lights: [L(0, [0.1, 0.2, 0.3], [0, 0, 0]), L(2, [1, 0.5, 0.25], [1, 2, 3], [0, 1, 0]), L(1, [0.4, 0.4, 0.4], [0, 5, 0]), L(2, [0.9, 0.9, 1.2], [4, 2, 1], [0.234486, 0, 0.0739459]), L(2, [1, 1, 1], [0, 3, 0], [0.01, 0.002, 0.0001])] },
        { index: 2, name: 'b', portals: [{ geometry: 1, target: 1, passable: true }, { geometry: 2, target: 1, passable: true }], lights: [L(0, [0.05, 0.05, 0.05], [0, 0, 0]), L(1, [0.9, 0.1, 0.1], [2, 5, 2]), L(2, [0.3, 0.6, 0.9], [5, 2, 5], [1, 0.3, 0.02]), L(2, [0.5, 0.5, 0.5], [6, 2, 6], [2, 0, 0.5])] },
        { index: 3, name: 'c', portals: [{ geometry: 3, target: 1, passable: true }], lights: [L(2, [0.7, 0.2, 0.2], [9, 2, 9], [1, 0, 0.05]), L(2, [0.2, 0.7, 0.2], [9, 2, 8], [0.5, 0.5, 0]), L(9, [0.2, 0.2, 0.7], [9, 2, 7], [3, 0, 0])] },
      ],
    };
    const defs: { id: string; cells?: { index: number }[] }[] = [b.model.def, busy];
    const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private', import.meta.url));
    for (const packId of ['gallery', 'tatooine', 'naboo']) {
      const f = join(PACKS, packId, 'manifest.json');
      if (!existsSync(f)) continue;
      const m = JSON.parse(readFileSync(f, 'utf8')) as { categories: Record<string, { id: string; cells?: { index: number }[] }[]> };
      for (const list of Object.values(m.categories)) for (const d of list) if (d.cells?.length) defs.push(d);
    }
    let rooms = 0;
    let lit = 0;
    let differ = '';
    const oldBody = before ? run(span(before, 'const cells = want.building.model.def.cells ?? [];', END)) : null;
    const k = { cap: INTERIOR_LIGHT_CAP, scale: ROOM_LIGHT_TUNE.lightScale, floor: ROOM_LIGHT_TUNE.ambientFloor, ambient: ROOM_LIGHT_TUNE.ambientScale };
    for (const def of defs) {
      for (const c of def.cells ?? []) {
        if (c.index <= 0) continue;
        const want = { building: { model: { def }, matrix }, cell: c.index };
        const a = pool();
        nowBody(want, THREE, a, k.cap, k.scale, k.floor, k.ambient, roomLightPlan);
        rooms++;
        if (a.interiorPoints.some((l) => l.intensity > 0)) lit++;
        if (!oldBody) continue;
        const o = pool();
        oldBody(want, THREE, o, constant(before!, 'INTERIOR_LIGHT_CAP'), constant(before!, 'INTERIOR_LIGHT_SCALE'), constant(before!, 'INTERIOR_AMBIENT_FLOOR'), constant(before!, 'INTERIOR_AMBIENT_SCALE'), roomLightPlan);
        const x = read(a);
        const y = read(o);
        if (!differ && !x.every((v, i) => Object.is(v, y[i]))) differ = `${def.id} room ${c.index}`;
      }
    }
    if (oldBody) ok(!differ && rooms > 4, `the room pool's lights, today's lines through roomLightPlan, are ${BEFORE_WAVE}'s own lines' to the bit over ${rooms} rooms (${lit} lit) of ${defs.length} buildings${differ ? `; not ${differ}` : ''}`);
    else console.log(`note: git cannot hand ${BEFORE_WAVE}'s world.ts over here; today's lines ran over ${rooms} rooms, and are held to the digest recorded from ${BEFORE_WAVE}'s`);
    // The digest over the two buildings that need no pack: today's always, 441c2f6's own where git answers.
    const lightsDigest = (body: (...a: unknown[]) => void, k2: typeof k) => {
      const hash = createHash('sha1');
      for (const def of [b.model.def, busy] as { cells?: { index: number }[] }[]) {
        for (const c of def.cells ?? []) {
          if (c.index <= 0) continue;
          const p = pool();
          body({ building: { model: { def }, matrix }, cell: c.index }, THREE, p, k2.cap, k2.scale, k2.floor, k2.ambient, roomLightPlan);
          hash.update(JSON.stringify(read(p)));
        }
      }
      return hash.digest('hex').slice(0, 16);
    };
    const nowLights = lightsDigest(nowBody, k);
    if (oldBody) {
      const thenLights = lightsDigest(oldBody, { cap: constant(before!, 'INTERIOR_LIGHT_CAP'), scale: constant(before!, 'INTERIOR_LIGHT_SCALE'), floor: constant(before!, 'INTERIOR_AMBIENT_FLOOR'), ambient: constant(before!, 'INTERIOR_AMBIENT_SCALE') });
      console.log(`note: ${BEFORE_WAVE}'s lines' digest ${thenLights}`);
      ok(thenLights === BEFORE_WAVE_LIGHTS, `${BEFORE_WAVE}'s own lines leave the pool as recorded (${thenLights})`);
    }
    ok(nowLights === BEFORE_WAVE_LIGHTS, `today's lines leave the pool for the TEST house and the busy building as ${BEFORE_WAVE}'s did (held to the digest recorded from them, ${BEFORE_WAVE_LIGHTS}; today ${nowLights})`);
    const busyPool = pool();
    nowBody({ building: { model: { def: busy }, matrix }, cell: 1 }, THREE, busyPool, k.cap, k.scale, k.floor, k.ambient, roomLightPlan);
    ok(busyPool.fxLampCells.join() === '1,1,1,2,2,2,2,3' && busyPool.interiorParallel.color.g === 0.4, `a room of more lights than the pool: its own first, a room two doorways open on twice, cut at the pool's eight, the first parallel its own (${busyPool.fxLampCells.join(',')})`);
  }

  // ---------------------------------------------------------------- 9. a stand-in for the shell, and a doorway whose first triangle has no area
  {
    // The TEST house under `auto` with a stand-in for the shell (a box round the whole house, under no cell), and its front
    // doorway drawn with a fifth corner on its bottom edge and its first triangle along that edge. Stood through the real
    // streamer: a body walks in through that doorway (the game reads a doorway's plane off its first triangle), and a ray
    // with the indoor filter (the terrain and the shell left out, as the player's own is) meets the hall's own floor, which
    // a stand-in for the shell taken for the whole house's would have left nothing under.
    const d2 = testHouse();
    const F = H.front;
    const mid = (F.y0 + F.y1) / 2;
    const five = [[-F.x, F.y0 - mid, 0], [F.x, F.y0 - mid, 0], [F.x, F.y1 - mid, 0], [-F.x, F.y1 - mid, 0], [0, F.y0 - mid, 0]];
    d2.meshes[3] = { name: 'Doorway', primitives: [{ positions: five.flat(), indices: [0, 4, 1, 4, 2, 3, 4, 1, 2, 0, 4, 3] }] };
    d2.nodes.push({ name: 'Shell-colonly', mesh: 0, translation: [0, 1.6, -5], scale: [4, 1.6, 5] });
    d2.scenes![0].nodes.push(d2.nodes.length - 1);
    const f2 = join(tmp, 'test_house_stand.glb');
    writeFileSync(f2, writeRawGlb(d2));
    const made2 = importModel(readSource(f2), { ...TEST_HOUSE_RECORD, id: 'test_house_stand', collision: 'auto' }, IMPORT_TUNE) as { refuse?: string[]; entry: { collision: string } };
    ok(!made2.refuse && made2.entry.collision === 'by room', `the house with a stand-in for its shell imports, colliding by room (${made2.refuse?.[0] ?? made2.entry.collision})`);
    writeImport(join(roots[SITE], 'imports-private'), made2 as never, 2000);
    const s2 = await standHouse(SITE, { ...ROW, id: 'house-3', model: 'test_house_stand' });
    const prev = new THREE.Vector3();
    const pos = new THREE.Vector3();
    let state = null as ReturnType<typeof s2.h.stream.trackCell>;
    const seen: string[] = [];
    for (let z = AT.z + 3; z > AT.z - 7.5; z -= 0.2) {
      prev.set(AT.x, 0.1, z);
      pos.set(AT.x, 0.1, z - 0.2);
      state = s2.h.stream.trackCell(state, prev, pos);
      const now = state ? `${state.cell}` : 'out';
      if (seen[seen.length - 1] !== now) seen.push(now);
    }
    ok(seen.join(' ') === 'out 1 2', `a body walks in through the doorway whose first triangle had no area (${seen.join(' > ')})`);
    s2.h.physics.stepOnce();
    const indoor = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));
    const down = (x: number, z: number) => {
      const hit = s2.h.physics.world.castRay(new RAPIER.Ray({ x, y: 2, z }, { x: 0, y: -1, z: 0 }), 5, true, undefined, indoor);
      return hit ? 2 - hit.timeOfImpact : null;
    };
    const hallFloor = down(AT.x + H.inHall[0], AT.z + H.inHall[2]);
    const parlourFloor = down(AT.x + H.inParlour[0], AT.z + H.inParlour[2]);
    ok(hallFloor !== null && close(hallFloor, 0.1, 1e-3) && parlourFloor !== null && close(parlourFloor, 0.1, 1e-3), `someone indoors stands on each room's own floor, the shell's stand-in left out as the indoor filter leaves the shell (the hall at ${hallFloor?.toFixed(3)}, the parlour at ${parlourFloor?.toFixed(3)})`);
    // And from the street the shell is its stand-in: a ray at its side wall stops on the stand-in's face (x 4), the wall's own
    // drawn pieces (x 3.9 to 4.1) colliding nowhere.
    const side = s2.h.physics.world.castRay(new RAPIER.Ray({ x: AT.x + 9, y: 1, z: AT.z - 5 }, { x: -1, y: 0, z: 0 }), 20, true, undefined, groups(Group.all, Group.all & ~Group.terrain));
    const sideAt = side ? AT.x + 9 - side.timeOfImpact : null;
    ok(sideAt !== null && close(sideAt, AT.x + 4, 1e-3), `from the street the shell collides by its stand-in alone (a ray at its side wall stops at x ${sideAt === null ? 'nothing' : (sideAt - AT.x).toFixed(3)} of the house)`);
    await s2.h.settle(AT, 1);
  }
} finally {
  globalThis.fetch = realFetch;
  g.createImageBitmap = realBitmap;
  if (!hadSelf) delete g.self;
  if (!hadProgress) delete g.ProgressEvent;
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`importRoomsWalk: ${checks} checks passed`);
