// The models a race course will bring in (`LayoutStreamer.modelsAlong`, the performance pass's first wave), through the
// real streamer over a world made up on the spot (`streamHarness.ts`): every region tier within its own range of any
// point along the course's legs, as the streamer itself loads them, and not the old warm's 1.7 km disc about every
// point. A tier-2 model 200 m off a leg is taken, one 600 m off every leg is not, a tier-0 model 1.5 km off is, and a
// building's furniture follows the building's raised room range.
import assert from 'node:assert/strict';
import { CRATE, HALL, ROCK, boxGeo, loadedOf, makeStreamer, type SnapshotObject } from './streamHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** An object at the game's (x, z): the snapshot mirrors x about the centre, which is nought here. */
const at = (model: string, x: number, z: number, extra: Partial<SnapshotObject> & { contained?: boolean; in?: number; cell?: number } = {}): SnapshotObject =>
  ({ template: `object/${model}`, model, x: -x, y: 0, z, q: [1, 0, 0, 0], radius: 8, ...extra }) as SnapshotObject;

/** A leg along z = `z` from x -400 to 400, sampled every 100 m, as the game samples a course's legs. */
const leg = (z: number) => Array.from({ length: 9 }, (_, i) => ({ x: -400 + i * 100, z }));

{
  // A crate (tier 2, 320 m) 200 m off the leg and another 600 m off it, and the world's rock (tier 0, 1.7 km) 1.5 km off.
  // Each in a region of its own: regions are 256 m squares, and a range is measured to a region's box.
  const h = await makeStreamer([at('crate', 0, 200), at('crate2', 0, 600), at('rock', 0, 1500)], {
    defs: [{ ...CRATE, id: 'crate2', file: 'crate2.glb' }],
    models: { crate2: loadedOf({ ...CRATE, id: 'crate2', file: 'crate2.glb' }, [{ geometry: boxGeo(1, 1, 1, 0), cell: -1 }]) },
  });
  const along = h.stream.modelsAlong(leg(0));
  ok(along.has('crate'), 'a tier-2 model 200 m off a leg is taken (its region within 320 m)');
  ok(!along.has('crate2'), 'one 600 m off every leg is not (its region 512 m off, past 320 m)');
  ok(along.has('rock'), 'a tier-0 model 1.5 km off is (its region within 1.7 km)');
  ok(along.get('crate') === false && along.get('rock') === false, 'none of them stands in a room');
  ok(h.stream.modelsAlong([]).size === 0, 'no points, no models');
  // The old warm's way, a disc of the first tier's range about a point, takes the far crate too: what made 583
  // models and 414 stand-ins of every start on the Dune Loop.
  ok(h.stream.modelsWithin(0, 0, 1700).has('crate2'), 'where the old warm\'s 1.7 km disc about the grid takes the far crate as well');
}

{
  // A building's furniture: a crate standing in a hall's room is filed with its region's tier raised to the rooms'
  // range plus the hall's reach (`regionRange`), so it is taken from as far as the hall's rooms can be built, where
  // the same crate standing alone at the same spot is left to its own 320 m.
  const hall = loadedOf(HALL, [
    { geometry: boxGeo(20, 8, 20, 0), cell: 0 },
    { geometry: boxGeo(18, 0.3, 18, 0), cell: 1 },
  ]);
  const inHall = await makeStreamer([at('hall', 0, 100), at('crate', 0, 100, { contained: true, in: 0, cell: 1, y: 0.3 } as never)], { defs: [HALL], models: { hall } });
  const alone = await makeStreamer([at('crate', 0, 100)]);
  const s = inHall.s;
  const region = [...s.regions.values()].find((r: { objects: { model: string }[][] }) => r.objects[2].some((o) => o.model === 'crate'));
  ok(!!region && region.indoor[2] >= 0, 'the crate in the hall raises its region\'s small tier to the rooms\' range');
  const raised = s.rangeOf(region, 2, s.roomRange());
  const own = s.ranges[2];
  ok(raised > own, `the raised range (${Math.round(raised)} m) is past the tier's own (${own} m)`);
  // A leg between the two: past the crate's own range from its region's box (z 0 to 256), within the raised one.
  const z = -(own + raised) / 2;
  ok(inHall.stream.modelsAlong(leg(z)).has('crate'), `the hall's crate is taken from a leg ${Math.round(-z)} m off, inside the hall's raised room range`);
  ok(inHall.stream.modelsAlong(leg(z)).get('crate') === true, 'and is marked as standing in a room, so both its passes are warmed');
  ok(!alone.stream.modelsAlong(leg(z)).has('crate'), 'the same crate standing alone there is left to its own range');
  ok(!inHall.stream.modelsAlong(leg(-raised - 40)).has('crate'), 'and past the raised range the hall\'s crate is left too');
}

{
  // The same model standing outdoors in one region and in a hall's room in another, both along the leg: its outdoor copy
  // is met first (the regions are walked in the order their first object was filed) and its indoor copy then raises
  // it to a model with a copy in a room, so both its passes are warmed. Left at the first copy's word, the rooms' pass
  // of the indoor copy would be built in play the first time it was drawn.
  const hall = loadedOf(HALL, [
    { geometry: boxGeo(20, 8, 20, 0), cell: 0 },
    { geometry: boxGeo(18, 0.3, 18, 0), cell: 1 },
  ]);
  const h = await makeStreamer([at('crate', 0, -100), at('hall', 0, 100), at('crate', 0, 100, { contained: true, in: 1, cell: 1, y: 0.3 } as never)], { defs: [HALL], models: { hall } });
  const along = h.stream.modelsAlong(leg(0));
  ok(along.get('crate') === true, 'a model with one copy outdoors and one in a room along the course is taken as standing in a room');
  const outdoorOnly = await makeStreamer([at('crate', 0, -100), at('crate', 0, 120)]);
  ok(outdoorOnly.stream.modelsAlong(leg(0)).get('crate') === false, 'and with both copies outdoors it is not');
}

{
  // A particle effect has no mesh to load or warm: never in the list, however near.
  const spark = { ...CRATE, id: 'spark', file: 'spark.prt', particle: true } as never;
  const h = await makeStreamer([at('spark', 0, 10), at('crate', 0, 20)], { defs: [spark] });
  const along = h.stream.modelsAlong(leg(0));
  ok(!along.has('spark') && along.has('crate'), 'a particle effect along the course is left out, the model beside it taken');
}

void ROCK;
console.log(`\ncourseModels: ${checks} checks passed`);
