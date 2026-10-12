// The permanent layer stood in a real world: `PermanentLayer` over the real streamer and the real physics,
// driven in node (`streamHarness.ts`), each row stood by the game's own two steps -- `dressingStandOf` decides
// what it stands as (its model, its place, whether it is solid) and the streamer's own `standPermanent` files
// it, which is all `World.standPlacement` does with a pack in hand -- out of the gallery pack standing behind
// the world, with the props catalogue and the seat and table tests stood in by a little table of their own.
//
// What is pinned: a building row and a prop row standing in it are filed under `place/<id>`, are solid once
// the sweep has run, are found by a story object's lookup, and the prop's collider names the template it really
// is; a prop filed **before** its building -- a story row in a world edit's house -- ends up drawn with that
// building's rooms, keeping what it is and whether it is solid, and stays so when the building is turned and
// stood again; a row that says `solid: false` never collides, and a seat or a table is never solid unless its
// row says so; a row moved is moved, once, and what is waited on for it settles only once it is built; a row
// taken out of the file comes down; a clash stands one; a world that has gone takes down nothing of the next,
// answers no question about it, and the next stands everything again; a guard is metres round the thing's own
// turned footprint, read live; a row renamed or moved to the other layer is called and guarded as it reads now;
// and a row the dev server's editor takes in hand is down until it is given back or saved, stands once where it
// was saved, and the file's own word that it changed, which follows every save, stands nothing. Nothing is written.
import assert from 'node:assert/strict';
import { CRATE, HALL, makeStreamer, gatePrepare, THREE, INDOOR_FILTER, type Harness } from './streamHarness.ts';

// After the harness, never beside it: a static import here would be resolved before the harness has put its
// stub in front of the particle player.
const { PermanentLayer, DRESSING_TUNE, keepOffOf, dressingStandOf, guardOf } = await import('../../../src/world/permanent.ts');
const { placementKey, readPlacementsFile, placementsFileText, toGame } = await import('../../../src/story/placements.ts');
const { isSeat } = await import('../../../src/world/ambient/fillers.ts');
const { isTableTemplate } = await import('../../../src/world/seatProps.ts');
type Row = import('../../../src/story/placements.ts').PlacementRow;
type Deps = import('../../../src/world/permanent.ts').PermanentDeps;

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

/** The crate's own template, which a props row carries as what it really is. */
const CRATE_TEMPLATE = 'object/tangible/container/shared_crate_test.iff';
/** The props catalogue, as far as these rows need it: each thing's model (all of them the crate) and template. */
const THINGS: Record<string, { model: string; template: string }> = {
  crate_test: { model: 'crate', template: CRATE_TEMPLATE },
  chair_test: { model: 'crate', template: 'object/tangible/furniture/all/shared_frn_all_chair_test.iff' },
  table_test: { model: 'crate', template: 'object/tangible/furniture/all/shared_frn_all_table_test.iff' },
};
/** The game's own test of what a seat or a table is, as `App.standDressingRow` hands it over. */
const furniture = (template: string) => isSeat(template) || isTableTemplate(template);

/** A layer's file for the harness's world (centre 0, 0: raw x is the game's x mirrored). */
function file(rows: Row[]) {
  return readPlacementsFile(placementsFileText('tatooine', 'raw', rows), 'tatooine', 'ground');
}

/** The hall a long way from the rock, in the raw frame, unturned or turned a quarter. */
const HALL_AT = { x: 300, z: 100 };
const QUARTER: [number, number, number, number] = [Math.SQRT1_2, 0, Math.SQRT1_2, 0];
const hallRow = (q: [number, number, number, number] = [1, 0, 0, 0], extra: Partial<Row> = {}): Row => ({ id: 'hall-1', kind: 'building', pack: 'gallery', model: 'hall', x: -HALL_AT.x, y: 0, z: HALL_AT.z, q, ...extra });
/** A crate standing in its room, two metres across and three along from its doorstep, on its floor. */
const crateRow = (extra: Partial<Row> = {}): Row => ({ id: 'locker', kind: 'prop', pack: 'props', thing: 'crate_test', x: -(HALL_AT.x + 2), y: 0.3, z: HALL_AT.z + 3, q: [1, 0, 0, 0], inside: true, ...extra });

/** A permanent layer over a harness, standing rows by the game's own two steps. */
function layerOver(h: Harness, gen: { n: number }) {
  return new PermanentLayer({
    stand: (row, g, key) => {
      const s = dressingStandOf(row, g, key, (thing) => THINGS[thing] ?? null, furniture);
      return s ? h.stream.standPermanent(s, h.gallery as never) : null;
    },
    unstand: (key) => void h.stream.unplace(key),
    packReady: () => true,
    generation: () => gen.n,
    label: (row) => row.name ?? row.id,
  });
}

/** The placed object filed under a key, as the streamer holds it. */
const placed = (h: Harness, key: string) => h.s.placedByKey.get(key);
/** How many entries the streamer files under keys of `place/`. */
const filedPlaces = (h: Harness) => [...h.s.placedByKey.keys()].filter((k: string) => k.startsWith('place/')).length;
/** What the first collider made for a placed object says it is. */
const colliderName = (h: Harness, o: unknown) => {
  const col = h.s.colliders.get(o)?.[0];
  return col ? h.stream.templateOfCollider(col.handle) : null;
};

// ---------------------------------------------------------------------------------------------
// 1. A building and the prop in it, both layers at once.
{
  const h = await makeStreamer();
  const gen = { n: 1 };
  const layer = layerOver(h, gen);
  layer.enter('tatooine', { x: 0, z: 0 }, 'ground', 1);
  layer.setLayers(file([crateRow()]), file([hallRow()]));
  await h.settle(HALL_AT);
  const hall = placed(h, placementKey('hall-1'));
  const crate = placed(h, placementKey('locker'));
  ok(!!hall && !!crate, '1: both rows are filed under place/<id>');
  ok(hall.x === HALL_AT.x && hall.z === HALL_AT.z && crate.x === HALL_AT.x + 2, `1: at their places in the game's frame, the raw x mirrored (${hall.x}, ${crate.x})`);
  ok((h.stream.placedState('place/hall-1')?.colliders ?? 0) > 0 && (h.stream.placedState('place/locker')?.colliders ?? 0) > 0, '1: and both are solid once the sweep has run');
  const top = h.rayDown(HALL_AT.x + 2, HALL_AT.z + 3, 5, INDOOR_FILTER);
  ok(top !== null && Math.abs(top - 1.3) < 0.05, `1: the game's own indoor ray meets the crate's top on the room's floor (${top})`);
  ok(h.stream.nearestPlaced(new Set([placementKey('locker')]), { x: HALL_AT.x + 2, y: 0.3, z: HALL_AT.z + 3 }, 30) === crate, "1: a story object's lookup finds the crate by its key");
  ok(colliderName(h, crate) === CRATE_TEMPLATE, `1: its collider names the template it really is, not the key it is filed under (${colliderName(h, crate)})`);
  ok(crate.host === hall, '1: and it is hosted by the building it stands in');
  ok(layer.count === 2 && layer.rowOf('place/locker')?.layer === 'story' && layer.rowOf('place/hall-1')?.layer === 'world', '1: the layer keeps both, each with its own layer');
  // The guard: a story row's is the tune's own, a world edit's none, and it reaches past the row's footprint.
  const s = layer.rowOf('place/locker')!;
  ok(guardOf(s) === DRESSING_TUNE.guard && guardOf(layer.rowOf('place/hall-1')!) === 0, `1: a story row is guarded ${DRESSING_TUNE.guard} m and a world edit not at all`);
  // The crate reaches half a metre either way from its middle; a quarter-metre thing reaches its guard until 2.25 m off.
  ok(layer.guardedAt(HALL_AT.x + 2 + 2.2, HALL_AT.z + 3, 0.25) === s, '1: a circle reaching into the guard past its edge is refused');
  ok(layer.guardedAt(HALL_AT.x + 2 + 2.3, HALL_AT.z + 3, 0.25) === null, '1: and one just clear of it is not');
  ok(layer.nearest({ x: HALL_AT.x + 2, y: 0.3, z: HALL_AT.z + 5 }, DRESSING_TUNE.nearReach) === s, '1: the pick-up key finds the crate as part of this world');
  // The tune is live: moved, it moves the guard of a row already standing, with nothing stood again.
  const was = DRESSING_TUNE.guard;
  DRESSING_TUNE.guard = 3;
  ok(layer.guardedAt(HALL_AT.x + 2 + 3.6, HALL_AT.z + 3, 0.25) === s && placed(h, 'place/locker') === crate, '1: the tune moved reaches rows already standing, re-standing nothing');
  DRESSING_TUNE.guard = 0;
  ok(layer.guardedAt(HALL_AT.x + 2, HALL_AT.z + 3, 0.25) === null, '1: and set to nought, a story row with no guard of its own guards nothing');
  DRESSING_TUNE.guard = was;
  // Another world arrived with nothing stood for it (its pack failed): the last world's crate is no answer there.
  gen.n = 2;
  ok(layer.guardedAt(HALL_AT.x + 2, HALL_AT.z + 3, 0.25) === null && layer.nearest({ x: HALL_AT.x + 2, y: 0.3, z: HALL_AT.z + 3 }, DRESSING_TUNE.nearReach) === null && layer.rowOf('place/locker') === null, "1: once its world has gone, its guard refuses nothing and the pick-up key finds nothing of it");
}

// 2. The prop filed first, its building second; then the building turned a quarter and stood again.
{
  const h = await makeStreamer();
  const gen = { n: 1 };
  const layer = layerOver(h, gen);
  layer.enter('tatooine', { x: 0, z: 0 }, 'ground', 1);
  // A second thing in the room, filed first too, that says it is never solid.
  const stool = (): Row => ({ ...crateRow(), id: 'stool', x: -(HALL_AT.x - 3), z: HALL_AT.z - 2, solid: false });
  layer.setLayer('story', file([crateRow(), stool()]));
  await h.settle(HALL_AT);
  ok(!placed(h, 'place/locker').host && !placed(h, 'place/stool').host, '2: things filed with no building yet have no host');
  layer.setLayer('world', file([hallRow()]));
  await h.settle(HALL_AT);
  const hall = placed(h, 'place/hall-1');
  const crate = placed(h, 'place/locker');
  ok(crate.host === hall, '2: once its building is filed, the crate is filed again under it');
  const rec = h.s.runtime.get(crate);
  ok(!!rec && rec.furniture.length === 1 && rec.furniture[0].host === hall, "2: its record's furniture entry names the building, so it is drawn with its rooms");
  ok(filedPlaces(h) === 3 && h.meshesAt(HALL_AT.x + 2, HALL_AT.z + 3) === 1, '2: filed once, with one mesh of its own');
  // Filed again from its own fields: still what it really is, and still never solid where it said so.
  ok(colliderName(h, crate) === CRATE_TEMPLATE && (h.stream.placedState('place/locker')?.colliders ?? 0) > 0, `2: filed again, the crate's collider still names what it really is (${colliderName(h, crate)})`);
  const st = placed(h, 'place/stool');
  ok(st.host === hall && st.solid === false && h.stream.placedState('place/stool')?.colliders === 0 && h.stream.placedState('place/stool')?.tierLoaded === true, '2: and the stool is hosted and still never solid');
  // Turned a quarter where it stands (x moved by nought): stood again, and the crate stays with it.
  layer.setLayer('world', file([hallRow(QUARTER, { x: -HALL_AT.x })]));
  await h.settle(HALL_AT);
  const hall2 = placed(h, 'place/hall-1');
  const crate2 = placed(h, 'place/locker');
  ok(hall2 !== hall && Math.abs(Math.abs(hall2.q.y) - Math.SQRT1_2) < 1e-9, '2: the building is stood again, turned a quarter');
  ok(crate2.host === hall2, '2: and the crate is still hosted, by the building as it stands now');
  const rec2 = h.s.runtime.get(crate2);
  ok(!!rec2 && rec2.furniture.length === 1 && rec2.furniture[0].host === hall2, '2: with its furniture entry under the new one');
  ok(filedPlaces(h) === 3 && h.meshesAt(HALL_AT.x + 2, HALL_AT.z + 3) === 1, '2: still one crate, with one mesh');
  ok(colliderName(h, crate2) === CRATE_TEMPLATE, '2: whose collider still names what it really is');
  const st2 = placed(h, 'place/stool');
  ok(st2.host === hall2 && st2.solid === false && h.stream.placedState('place/stool')?.colliders === 0, '2: and the stool is still hosted and never solid');
}

// 3. Never solid, moved, removed, a clash, and a world that has gone.
{
  const h = await makeStreamer();
  const gate = gatePrepare(h.stream);
  const gen = { n: 1 };
  const layer = layerOver(h, gen);
  layer.enter('tatooine', { x: 0, z: 0 }, 'ground', 1);
  const out = { x: 600, z: 100 };
  const loose = (extra: Partial<Row> = {}): Row => ({ id: 'bench', kind: 'prop', pack: 'props', thing: 'crate_test', x: -out.x, y: 0, z: out.z, q: [1, 0, 0, 0], ...extra });
  const ghost: Row = { id: 'ghost', kind: 'prop', pack: 'props', thing: 'crate_test', x: -(out.x + 5), y: 0, z: out.z, q: [1, 0, 0, 0], solid: false };
  layer.setLayers(null, file([loose(), ghost]));
  await h.settle(out);
  ok((h.stream.placedState('place/bench')?.colliders ?? 0) === 1, '3: a crate row is solid');
  ok(h.stream.placedState('place/ghost')?.tierLoaded === true && h.stream.placedState('place/ghost')?.colliders === 0 && h.rayDown(out.x + 5, out.z) === null, '3: and one that says solid: false never collides');
  // What stands out in the open says what it really is to whoever asks what is near (the seats of ours).
  const near = h.stream.objectsNear(out.x, out.z, 3).find((o) => o.template === 'place/bench');
  ok(near?.effectsOf === CRATE_TEMPLATE, `3: and is listed near with the template it really is (${near?.effectsOf})`);
  const meshes = h.scene.children.length;
  // Moved into a tier already standing: what is waited on for it settles only once its programs are built.
  gate.arm();
  const builds = layer.setLayers(null, file([loose({ x: -(out.x + 2) }), ghost]));
  let built = false;
  void Promise.all(builds).then(() => {
    built = true;
  });
  for (let i = 0; i < 5 && !gate.held; i++) await new Promise((r) => setTimeout(r, 0));
  ok(builds.length === 1 && gate.held && !built, `3: a row moved into a standing tier hands back what to wait on, which waits while it is being built (${builds.length})`);
  gate.open();
  await Promise.all(builds);
  ok(built && h.meshesAt(out.x + 2, out.z) === 1 && h.hasRecord('place/bench'), '3: and settles once it is built and shown');
  await h.settle(out);
  ok([...h.s.placedByKey.keys()].filter((k: string) => k === 'place/bench').length === 1 && placed(h, 'place/bench').x === out.x + 2, '3: a row moved two metres is filed once, where it is now');
  ok(h.scene.children.length === meshes && h.meshesAt(out.x, out.z) === 0 && h.meshesAt(out.x + 2, out.z) === 1, `3: and the scene holds as many meshes as before, the old one gone (${h.scene.children.length} against ${meshes})`);
  // A name-only change re-stands nothing, and the row is called by its new name.
  const before = placed(h, 'place/bench');
  layer.setLayers(null, file([loose({ x: -(out.x + 2), name: 'Bench', note: 'renamed' }), ghost]));
  ok(placed(h, 'place/bench') === before, '3: a change of name and note re-stands nothing');
  ok(layer.rowOf('place/bench')?.label === 'Bench' && layer.rowOf('place/bench')?.row.name === 'Bench', '3: and the row standing is called by its new name');
  // Moved to the other layer unchanged: it stands as it stood, and is layered and guarded as it reads now.
  layer.setLayers(file([loose({ x: -(out.x + 2), name: 'Bench' })]), file([ghost]));
  const s = layer.rowOf('place/bench');
  ok(placed(h, 'place/bench') === before && s?.layer === 'story' && !!s && guardOf(s) === DRESSING_TUNE.guard && layer.guardedAt(out.x + 2, out.z, 0.25) === s, '3: moved to the story layer unchanged, it is not stood again and takes the story layer\'s guard');
  layer.setLayers(null, file([loose({ x: -(out.x + 2), name: 'Bench' }), ghost]));
  ok(layer.rowOf('place/bench')?.layer === 'world' && layer.guardedAt(out.x + 2, out.z, 0.25) === null, '3: and back in the world edits, it guards nothing again');
  layer.setLayers(null, file([ghost]));
  await h.settle(out);
  ok(!placed(h, 'place/bench') && h.meshesAt(out.x + 2, out.z) === 0 && layer.count === 1, '3: a row taken out of the file is taken down');
  // A seat and a table are never solid unless their row says so; anything else is.
  const seatRow = (id: string, thing: string, x: number, extra: Partial<Row> = {}): Row => ({ id, kind: 'prop', pack: 'props', thing, x: -(out.x + x), y: 0, z: out.z + 10, q: [1, 0, 0, 0], ...extra });
  layer.setLayers(null, file([ghost, seatRow('chair', 'chair_test', 0), seatRow('table', 'table_test', 3), seatRow('chair-solid', 'chair_test', 6, { solid: true })]));
  await h.settle(out);
  ok(placed(h, 'place/chair').solid === false && placed(h, 'place/table').solid === false && h.stream.placedState('place/chair')?.colliders === 0 && h.stream.placedState('place/table')?.colliders === 0, '3: a permanent seat and table are never solid, as the seats of ours are');
  ok(placed(h, 'place/chair-solid').solid === true && h.stream.placedState('place/chair-solid')?.colliders === 1, '3: unless the row says solid: true');
  layer.setLayers(null, file([ghost]));
  await h.settle(out);
  // Both layers holding one id: the world edit stands and the story row is a clash.
  layer.setLayers(file([loose({ name: 'story one' })]), file([ghost, loose({ x: -(out.x + 8), name: 'world one' })]));
  await h.settle(out);
  const r = layer.report();
  ok(filedPlaces(h) === 2 && placed(h, 'place/bench').x === out.x + 8 && layer.rowOf('place/bench')?.layer === 'world', '3: a clash stands one, the world edit');
  ok(r.layers.story.skipped.clash === 1 && r.rows.some((x) => x.id === 'bench' && x.layer === 'story' && x.why === 'clash'), '3: and names the story row a clash');
  // The world goes (another generation, its streamer gone with it): nothing here touches the next world, and
  // before anything is stood there nothing is answered with this world's rows.
  gen.n = 2;
  ok(layer.rowOf('place/bench') === null && layer.nearest({ x: out.x + 8, y: 0, z: out.z }, 10) === null && layer.count === 0 && [...layer.standing].length === 0, '3: once its world has gone, the layer answers nothing of what stood there');
  ok(layer.guardedAt(out.x + 8, out.z, 0.25) === null && layer.report().current === false, "3: and its guard refuses nothing in the world that came after");
  const h2 = await makeStreamer();
  const next = layerOver(h2, gen);
  // The old layer, asked to sync in a world it was not entered for, takes nothing down and stands nothing.
  layer.setLayers(null, file([]));
  ok(filedPlaces(h) === 2 && layer.count === 0, '3: a layer whose world has gone forgets what stood and takes nothing down');
  next.enter('tatooine', { x: 0, z: 0 }, 'ground', 2);
  next.setLayers(file([loose({ name: 'story one' })]), file([ghost, loose({ x: -(out.x + 8) })]));
  await h2.settle(out);
  ok(filedPlaces(h2) === 2 && (h2.stream.placedState('place/bench')?.colliders ?? 0) === 1, '3: the next world stands everything again');
  // In the dungeons' world of copies every row is skipped, and in space every building.
  const copies = layerOver(h2, gen);
  copies.enter('dungeon1', { x: 0, z: 0 }, 'copies', 2);
  copies.setLayers(null, readPlacementsFile(placementsFileText('dungeon1', 'raw', [hallRow()]), 'dungeon1', 'ground'));
  ok(copies.count === 0 && copies.report().layers.world.skipped.copies === 1, '3: the world of copies stands nothing');
  const space = layerOver(h2, gen);
  space.enter('space_tatooine', null, 'space', 2);
  space.setLayers(null, readPlacementsFile(placementsFileText('space_tatooine', 'game', [{ ...hallRow(), id: 'station-hall' }, { ...loose(), id: 'space-crate', x: 1500, z: 900 }]), 'space_tatooine', 'space'));
  ok(space.count === 1 && space.report().layers.world.skipped.space === 1, '3: a space zone stands the crate and skips the building');
  ok(placed(h2, 'place/space-crate')?.x === 1500, "3: and a space zone's file is in the game's own frame, read as it stands");
}

// 4. The flora circles, and the streamer keeping each once.
{
  const story = file([crateRow({ clear: 3 })]);
  const world = file([hallRow([1, 0, 0, 0], { clear: 14.5 }), { ...crateRow(), id: 'locker', clear: 9 }]);
  const k = keepOffOf(story, world, 'ground');
  ok(k.raw.length === 2 && k.game.length === 0 && k.raw.some((c) => c.r === 14.5) && !k.raw.some((c) => c.r === 3), '4: the plants are kept off what both layers ask, the clashing story row left out, in the raw frame');
  ok(keepOffOf(story, world, 'copies').raw.length === 0, '4: and nothing in the world of copies');
  const h = await makeStreamer();
  h.stream.keepFloraOff(300, 100, 14.5);
  h.stream.keepFloraOff(300, 100, 14.5);
  const cell = h.stream.exclusionsFor(Math.floor(300 / 64), Math.floor(100 / 64));
  ok(cell.filter((e) => e.x === 300 && e.z === 100).length === 1, '4: one circle asked for twice is kept once');
}

// 5. A house's guard is round its own footprint, not round its doorstep. A box that reaches 12 m either side
//    of the doorstep, 4 m out in front of it and 28 m back from it (the shape of a medium house, whose origin is
//    its doorstep), in a story row, stood unturned and turned a quarter: a point is tested in the house's own
//    frame and carried into the world by three's own quaternion, so the test holds whichever way a turn reads.
{
  const BOX = { min: [-12, -16, -28], max: [12, 8, 4] };
  const deps: Deps = { stand: () => ({ bounds: BOX }), unstand: () => {}, packReady: () => true, generation: () => 1 };
  for (const [what, q] of [
    ['unturned', [1, 0, 0, 0]],
    ['turned a quarter', QUARTER],
    ['turned an eighth', [Math.cos(Math.PI / 8), 0, Math.sin(Math.PI / 8), 0]],
  ] as const) {
    const layer = new PermanentLayer(deps);
    layer.enter('tatooine', { x: 0, z: 0 }, 'ground', 1);
    const row: Row = { id: 'house', kind: 'building', pack: 'gallery', model: 'hall', x: -50, y: 0, z: 70, q: [...q] as [number, number, number, number] };
    layer.setLayers(file([row]), null);
    const g = toGame(row, { x: 0, z: 0 }, 'raw');
    const turn = new THREE.Quaternion(g.q[0], g.q[1], g.q[2], g.q[3]);
    const at = (lx: number, lz: number) => new THREE.Vector3(lx, 0, lz).applyQuaternion(turn).add(new THREE.Vector3(g.x, 0, g.z));
    const asked = (lx: number, lz: number) => {
      const p = at(lx, lz);
      return layer.guardedAt(p.x, p.z, 0) !== null;
    };
    ok(asked(0, -25), `5 (${what}): its back rooms, 25 m behind the door, are guarded`);
    ok(asked(0, 5.4) && !asked(0, 5.6), `5 (${what}): in front, the guard ends ${DRESSING_TUNE.guard} m past its front wall, not out in the street`);
    ok(asked(13.4, -10) && !asked(13.6, -10) && asked(-13.4, -10) && !asked(-13.6, -10), `5 (${what}): and ${DRESSING_TUNE.guard} m past either side wall`);
    ok(asked(0, -29.4) && !asked(0, -29.6), `5 (${what}): and past its back wall`);
  }
}

// 6. The dev server's editor: a row taken in hand is down and stays down while files are read again, comes back
//    where it stood when it is given back, and stands once where it was saved; the file's own word that it
//    changed, which follows every save, then stands nothing.
{
  const h = await makeStreamer();
  const gen = { n: 1 };
  const layer = layerOver(h, gen);
  layer.enter('tatooine', { x: 0, z: 0 }, 'ground', 1);
  const out = { x: 800, z: 100 };
  const row = (extra: Partial<Row> = {}): Row => ({ id: 'locker', kind: 'prop', pack: 'props', thing: 'crate_test', x: -out.x, y: 0, z: out.z, q: [1, 0, 0, 0], ...extra });
  const world = file([row()]);
  layer.setLayers(null, world);
  await h.settle(out);
  const first = placed(h, 'place/locker');
  ok(!!first && (h.stream.placedState('place/locker')?.colliders ?? 0) === 1, '6: a row stands, and is solid');
  const lifted = layer.lift('place/locker');
  ok(lifted?.row.id === 'locker' && lifted.layer === 'world' && !placed(h, 'place/locker') && h.meshesAt(out.x, out.z) === 0 && layer.inHand('place/locker'), '6: taken in hand it is down in the world at once, its row and layer handed over');
  ok(layer.rowOf('place/locker') === null && layer.report().rows.some((x) => x.id === 'locker' && x.why === 'inHand'), "6: and is reported in hand, not standing");
  // The file read again while it is in hand (the dev server's word for somebody else's save) does not stand it under the ghost.
  const again = layer.setLayers(null, world);
  await h.settle(out);
  ok(!placed(h, 'place/locker') && again.length === 0, '6: a file read again while it is in hand does not stand it a second time');
  // Given back unchanged: stood again where it stood, once.
  layer.restore('place/locker');
  await h.settle(out);
  const back = placed(h, 'place/locker');
  ok(!!back && back !== first && back.x === out.x && filedPlaces(h) === 1 && h.meshesAt(out.x, out.z) === 1 && !layer.inHand('place/locker'), '6: given back, it stands again where it stood, once');
  // Taken up and saved two metres along, with its words: the save's answer stands it there, once.
  layer.lift('place/locker');
  const saved = file([row({ x: -(out.x + 2), name: 'Locker', at: 1_760_000_000_000 })]);
  const builds = layer.land('place/locker', null, saved);
  await Promise.all(builds);
  await h.settle(out);
  const moved = placed(h, 'place/locker');
  ok(!!moved && moved.x === out.x + 2 && filedPlaces(h) === 1 && h.meshesAt(out.x, out.z) === 0 && h.meshesAt(out.x + 2, out.z) === 1 && layer.rowOf('place/locker')?.label === 'Locker', '6: saved somewhere else it stands there, once, under its new name');
  // The dev server's word that the file changed follows, read from the file as written: nothing stands again.
  const echo = layer.setLayer('world', readPlacementsFile(placementsFileText('tatooine', 'raw', saved.rows), 'tatooine', 'ground'));
  await h.settle(out);
  ok(echo.length === 0 && placed(h, 'place/locker') === moved && filedPlaces(h) === 1 && h.meshesAt(out.x + 2, out.z) === 1, '6: the file read again after the save is a diff with nothing in it: the very same thing stands');
  // Saved unmoved: stood again all the same, which a sync that still believed it stood would never do.
  layer.lift('place/locker');
  layer.land('place/locker', null, saved);
  await h.settle(out);
  ok(!!placed(h, 'place/locker') && placed(h, 'place/locker').x === out.x + 2 && filedPlaces(h) === 1, '6: put down unmoved, it stands again');
  // A row taken out of its file while it is in hand is not stood when it is given back.
  layer.lift('place/locker');
  layer.land('place/locker', null, null);
  await h.settle(out);
  ok(!placed(h, 'place/locker') && layer.count === 0, '6: taken out of its file while in hand, it stays gone');
  // A world that has gone forgets what was in hand.
  layer.setLayers(null, world);
  await h.settle(out);
  layer.lift('place/locker');
  gen.n = 2;
  ok(!layer.inHand('place/locker') && layer.restore('place/locker').length === 0, '6: once its world has gone, nothing is in hand and nothing is given back into the next');
  // A travel or the select screen leaves a row in hand as its file has it (`keep`), so the next arrival stands it:
  // the world entered again forgets the hand, and the very file stands it -- and so does a row of the same id in
  // the next world, since ids are minted per world's files and `crate-1` recurs on every one.
  layer.enter('tatooine', { x: 0, z: 0 }, 'ground', 2);
  layer.setLayers(null, world);
  await h.settle(out);
  ok(!!placed(h, 'place/locker') && placed(h, 'place/locker').x === out.x && !layer.inHand('place/locker') && filedPlaces(h) === 1, '6: the next arrival forgets what was in hand, and stands the row its file still holds');
  layer.lift('place/locker');
  gen.n = 3;
  layer.enter('naboo', { x: 0, z: 0 }, 'ground', 3);
  const elsewhere = { x: 820, z: 140 };
  layer.setLayers(null, readPlacementsFile(placementsFileText('naboo', 'raw', [row({ x: -elsewhere.x, z: elsewhere.z })]), 'naboo', 'ground'));
  await h.settle(elsewhere);
  ok(!!placed(h, 'place/locker') && placed(h, 'place/locker').x === elsewhere.x && !layer.inHand('place/locker'), "6: and a row of another world under the same id stands there: the last world's hand is not this one's");
}

// 6b. A save answered while other rows stand: only the row that was in hand is stood again, and every other row is
//     the very thing that stood before, filed once -- `land` is one diff, never a second stand of everything.
{
  const h = await makeStreamer();
  const gen = { n: 1 };
  const layer = layerOver(h, gen);
  layer.enter('tatooine', { x: 0, z: 0 }, 'ground', 1);
  const out = { x: 800, z: 100 };
  const row = (id: string, x: number, extra: Partial<Row> = {}): Row => ({ id, kind: 'prop', pack: 'props', thing: 'crate_test', x: -x, y: 0, z: out.z, q: [1, 0, 0, 0], ...extra });
  layer.setLayers(null, file([row('locker', out.x), row('other', out.x + 6)]));
  await h.settle(out);
  const other = placed(h, 'place/other');
  ok(!!other && !!placed(h, 'place/locker') && filedPlaces(h) === 2, '6b: two rows stand');
  layer.lift('place/locker');
  layer.land('place/locker', null, file([row('locker', out.x + 2, { at: 1 }), row('other', out.x + 6)]));
  await h.settle(out);
  ok(placed(h, 'place/other') === other && filedPlaces(h) === 2 && placed(h, 'place/locker')?.x === out.x + 2, '6b: the save stands the row that was in hand where it was saved, and the row beside it is the very thing that stood, filed once');
  ok(h.meshesAt(out.x + 6, out.z) === 1, '6b: drawn once');
}

ok(CRATE.id === 'crate' && HALL.cells.length === 2, 'the harness carries the crate and the hall');
console.log(`\n${passed} checks passed`);
