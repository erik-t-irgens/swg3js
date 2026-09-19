// The space map's layers: a zone's pack turned into marks, the view's follow flag, and the pools the
// map draws from. Synthetic data only: every pack below is made up, no file of the client's is read,
// and the numbers are chosen to be easy to check by eye. Each case says what real shape it stands for.
import assert from 'node:assert/strict';
import {
  distanceText, drawnAsLine, drawnAsShell, hasLayer, labelFrom, LAYERS, MapView, marksOf, ObjectList, Pool, poolWants, rgbOf, ShipList, VIEW_TUNE, type MapMark, type MapPack,
} from '../../../src/ui/spaceMapLayers.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const find = (marks: MapMark[], key: string): MapMark => {
  const m = marks.find((x) => x.key === key);
  assert.ok(m, `no mark ${key}`);
  return m;
};

// 1. A pack with everything in it. It stands for a zone converted with fields, nebulae and lanes:
// the stations and the hyperspace points are in the client's frame and the map mirrors them, while
// the fields and the nebulae were mirrored by the converter and carry `at`.
const full: MapPack = {
  zone: 'a_zone',
  stations: [{ name: 'station_one', title: 'One Station', description: 'a place to dock', x: 1000, y: 200, z: -300, radius: 250, model: 'model_a' }],
  scenery: [{ name: 'big_hull', x: -500, y: 0, z: 400, radius: 900, model: 'model_b', invented: true }],
  hyperspace: { points: [{ id: 'point_one', name: 'First Point', description: 'a point', x: 40, y: 0, z: 60, source: 'table' }, { id: 'point_two', x: 0, y: 5, z: 0, source: 'invented' }] },
  arrival: { kind: 'launch', x: 70, y: 10, z: 20 },
  fields: [
    { name: null, at: [800, 0, 900], radius: 400, kind: 'sphere' },
    { name: 'long_belt', at: [0, 0, 0], radius: 150, kind: 'spline', spline: [[10, 0, 0], [20, 0, 30], [30, 0, 60]] },
  ],
  nebulae: [{ name: 'pirate_add', at: [-4000, 4000, 0], radius: 4000, density: 1, facing: { colour: [0.65, 1, 0.8, 0.8] } }],
  lanes: { model_a: { lanes: [{}, {}, {}] } },
};
const marks = marksOf(full);
ok(marks.length === 8, 'every layer of a full pack gives its marks');

const station = find(marks, 'stations:station_one');
ok(station.x === -1000 && station.y === 200 && station.z === -300, 'a station is mirrored into the game\'s frame');
ok(station.name === 'One Station' && station.description === 'a place to dock', 'a station keeps the game\'s own title and description');
ok(station.destination === 'a_zone:station_one', 'a station can be jumped to, by the key the System Map uses');
ok(station.lanes === 3 && !station.invented, 'a station says how many docking lanes its model has');

const scenery = find(marks, 'scenery:big_hull');
ok(scenery.layer === 'stations' && scenery.x === 500 && scenery.destination === null && scenery.invented, 'scenery rides the stations layer, is mirrored, cannot be jumped to, and says it is made up');
ok(scenery.name === 'Big hull' && scenery.lanes === 0, 'scenery with no lanes in the pack has none, and is named from its id');

ok(find(marks, 'points:point_one').destination === 'a_zone:point_one', 'a hyperspace point carries its own key');
ok(find(marks, 'points:point_two').invented && find(marks, 'points:point_two').name === 'Point two', 'a made-up point says so and is named from its id');
ok(find(marks, 'launch:launch').destination === 'a_zone:launch' && find(marks, 'launch:launch').x === -70, 'the launch point is a destination and is mirrored');

const sphere = find(marks, 'fields:0');
ok(sphere.x === 800 && sphere.z === 900 && sphere.spline === null, 'a field written with `at` is taken as it stands, in the game\'s frame');
ok(sphere.name === 'asteroid field', 'a field whose Name column is empty gets a plain name');
const belt = find(marks, 'fields:long_belt');
ok(!!belt.spline && belt.spline.length === 3 && belt.spline[2][0] === 30 && belt.spline[2][2] === 60, 'a spline field keeps its control points in the frame its centre is in');

const nebula = find(marks, 'nebulae:pirate_add');
ok(nebula.x === -4000 && nebula.radius === 4000, 'a nebula keeps the converter\'s mirrored centre');
ok(!!nebula.colour && near(nebula.colour[0], 1) && near(nebula.colour[1], 0.8) && near(nebula.colour[2], 0.8), 'a nebula\'s colour drops the table\'s leading alpha');
ok(nebula.destination === null, 'a nebula is not somewhere to jump to');

// 2. A pack converted before version 3, and no pack at all.
const older: MapPack = { zone: 'b_zone', stations: [{ name: 'station_b', x: 0, y: 0, z: 0, radius: 100 }], hyperspace: { points: [] } };
const old = marksOf(older);
ok(old.length === 1 && old[0].layer === 'stations', 'an older pack gives its stations and no field, nebula or launch mark');
ok(old[0].lanes === 0 && old[0].name === 'Station b', 'an older pack\'s station has no lanes and is named from its id when it has no title');
ok(marksOf(null).length === 0 && marksOf(undefined).length === 0, 'no pack gives no marks');

// 3. A client-frame zero must not come back as a negative zero, or a mark's readout reads "-0".
const zeroed = marksOf({ zone: 'c', stations: [{ name: 's', x: 0, y: 0, z: 0 }] });
ok(Object.is(zeroed[0].x, 0), 'an X of zero stays a plain zero when it is mirrored');

// 4. The small readers.
ok(rgbOf([0.5, 0.1, 0.2, 0.3])?.[0] === 0.1, 'four numbers are read alpha first');
ok(rgbOf([0.1, 0.2, 0.3])?.[2] === 0.3, 'three numbers are read as they stand');
ok(rgbOf({ r: 1, g: 0.5, b: 0 })?.[1] === 0.5, 'a named colour is read by its names');
ok(rgbOf(null) === null && rgbOf([1, 2]) === null, 'nothing readable gives no colour');
ok(labelFrom('') === 'unnamed' && labelFrom('main') === 'Main', 'a name is made from an id, and an empty id is named plainly');
ok(distanceText(430) === '430 m' && distanceText(4300) === '4.3 km' && distanceText(43000) === '43 km', 'a distance reads in metres under a kilometre and in kilometres over it');

// 5. The view's follow flag. This is the bug the layers were split for: sliding the view used to be
// undone on the next frame, because one flag meant both "has been centred" and "keep following".
const view = new MapView();
ok(view.follow, 'the view follows the ship to begin with');
view.frameShip(10, 20, 30);
ok(view.target.x === 10 && view.target.z === 30, 'while following, the view takes the ship\'s place each frame');
view.turn(100, 0);
ok(view.follow && near(view.orbit.yaw, 0.6 - 100 * VIEW_TUNE.turnPerPixel), 'turning the view never stops it following');
view.turn(0, 10000);
ok(near(view.orbit.pitch, VIEW_TUNE.pitchLimit), 'the view cannot be tipped past its limit');
view.pan(10, 0, 2, 1, 0, 0, 0, 1, 0);
ok(!view.follow && near(view.target.x, 10 - 20), 'sliding the view moves the point looked at along the camera\'s right, and stops it following');
view.frameShip(999, 999, 999);
ok(near(view.target.x, -10), 'a view that is not following is left where it was put');
view.followShip();
ok(view.follow, 'F puts the view back on the ship');
view.frameShip(5, 5, 5);
ok(view.target.x === 5, 'and it takes the ship\'s place again on the next frame');

// 6. Zooming. The wheel always zooms toward what is under the cursor, and zooming never stops the
// view following: while it follows, the next frame puts the point looked at back on the ship.
const zoom = new MapView();
zoom.orbit.distance = 1000;
zoom.zoom(1);
ok(near(zoom.orbit.distance, 1000 * VIEW_TUNE.zoomStep) && zoom.follow, 'a wheel notch out multiplies the distance and keeps following');
zoom.orbit.distance = 1000;
zoom.target.x = 0;
zoom.zoomToward(1, 100, 0, 0);
ok(zoom.follow, 'zooming toward a point while following does not stop it following');
zoom.frameShip(7, 8, 9);
ok(zoom.target.x === 7 && zoom.target.y === 8 && zoom.target.z === 9, 'and the next frame puts the point looked at back on the ship');
zoom.orbit.distance = 1000;
zoom.centreOn(0, 0, 0);
zoom.zoomToward(1, 100, 0, 0);
ok(!zoom.follow && near(zoom.target.x, 100 - 100 * VIEW_TUNE.zoomStep), 'zooming out about a point moves the point looked at away from it by the same share');
zoom.orbit.distance = VIEW_TUNE.distanceMax;
zoom.zoom(10);
ok(zoom.orbit.distance === VIEW_TUNE.distanceMax, 'the view cannot be zoomed out past its far limit');
zoom.orbit.distance = VIEW_TUNE.distanceMin;
zoom.zoom(-10);
ok(zoom.orbit.distance === VIEW_TUNE.distanceMin, 'nor in past its near one');

// 7. The pools. Nothing may be made after the first frame that wanted that many.
let shown = 0;
const pool = new Pool<{ id: number; on: boolean }>(
  () => ({ id: shown++, on: false }),
  (item, on) => (item.on = on),
);
pool.begin();
for (let i = 0; i < 3; i++) pool.take();
pool.end();
ok(pool.made === 3 && pool.used === 3, 'the first frame makes what it wants');
pool.begin();
for (let i = 0; i < 2; i++) pool.take();
pool.end();
ok(pool.made === 3 && pool.items.length === 3 && !pool.items[2].on, 'a smaller frame makes nothing and hides what it did not take');
pool.begin();
for (let i = 0; i < 3; i++) pool.take();
pool.end();
ok(pool.made === 3 && pool.items.every((x) => x.on), 'the same frame again makes nothing and shows them all');
pool.begin();
for (let i = 0; i < 4; i++) pool.take();
pool.end();
ok(pool.made === 4, 'only a frame that wants more than any before it makes one more');

// 8. The ship list: the game writes into entries the map owns, so no frame makes an array or a quaternion.
const ships = new ShipList();
for (let frame = 0; frame < 3; frame++) {
  ships.begin();
  ships.add(1, 2, 3, 0, 0, 0, 1, false, 'a ship');
  ships.add(4, 5, 6, 0, 0, 0, 1, true, 'your ship');
  ok(ships.length === 2 && ships.mine?.x === 4, `frame ${frame + 1}: two ships, and the player's own is found`);
}
ok(ships.made === 2 && ships.items.length === 2, 'three frames of two ships made two entries in all');
ships.begin();
ships.add(0, 0, 0, 0, 0, 0, 1, false, 'a ship');
ok(ships.length === 1 && ships.mine === null && ships.items.length === 2, 'a frame with nothing of the player\'s reads no mark of theirs, and the spare entry stays');

const objects = new ObjectList();
for (let frame = 0; frame < 2; frame++) {
  objects.begin();
  objects.add(1, 1, 1, 50, false);
  objects.add(2, 2, 2, 300, true);
}
ok(objects.length === 2 && objects.items.length === 2 && objects.items[1].station, 'the object list is filled in place too');

// 9. Growing a pool to what a zone wants, so that no drawn frame is the first to want one. This is
// what keeps a material (and the program built from it) out of a frame.
const grown = new Pool<{ on: boolean }>(() => ({ on: true }), (x, on) => (x.on = on));
grown.grow(3);
ok(grown.made === 3 && grown.items.length === 3 && grown.used === 0, 'growing makes them without taking any');
ok(grown.items.every((x) => !x.on), 'a grown item is hidden until a frame takes it');
grown.begin();
for (let i = 0; i < 3; i++) grown.take();
grown.end();
ok(grown.made === 3, 'the first frame after growing makes nothing');
grown.grow(2);
ok(grown.made === 3 && grown.items.length === 3, 'growing to fewer than it holds makes nothing');

// 10. Which pool a mark is drawn from, and how many of each a zone wants. A belt is its own shape:
// the table's radius is how thick it is, not how far it reaches, so it gets a line and no shell.
ok(drawnAsLine(belt) && !drawnAsShell(belt), 'a spline field is drawn as a belt and not as a shell');
ok(drawnAsShell(sphere) && !drawnAsLine(sphere), 'a round field is drawn as a shell');
ok(drawnAsShell(nebula) && !drawnAsLine(nebula), 'a nebula is drawn as a shell');
ok(!drawnAsShell(station) && !drawnAsLine(station), 'a station is drawn as neither a shell nor a belt');
const wants = poolWants(marks, 48);
ok(wants.marks === 5 && wants.shells === 2 && wants.splines === 1, 'a full pack wants five marks, two shells and one belt');
ok(wants.labels === 8 && poolWants(marks, 3).labels === 3, 'the labels are capped at what the map has');
ok(poolWants([], 48).marks === 0 && poolWants([], 48).labels === 0, 'a zone with no marks wants nothing');
ok(hasLayer(marks, 'stations') && !hasLayer(marksOf(null), 'stations'), 'the map can tell whether a pack gave a station at all');
ok(!hasLayer(old, 'nebulae'), 'an older pack gave no nebula');

// 11. Every layer has a box and an icon name, and the marks only ever use those layers.
ok(LAYERS.length === 6 && LAYERS.every((l) => !!l.label && /^zone_[a-z]+$/.test(l.icon)), 'each layer has a name and a zone-map icon');
const ids = new Set(LAYERS.map((l) => l.id));
ok(marks.every((m) => ids.has(m.layer)), 'every mark belongs to a layer that has a box');

console.log(`\n${checks} checks passed`);
