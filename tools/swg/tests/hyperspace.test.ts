// Hyperspace: the jump scene and the point tables as the converter reads them, the made-up contents of
// Kessel and Deep Space, the zone lists, the runtime's jump arithmetic and destinations, and the huge
// collider's pieces. Synthetic data only: no file of the client's is read and every figure here is made up
// (the scene's seconds, speed and timings, the distances; the real frame check is the converter's own, run
// on the owner's machine). The strings in cases 2 and 3 have the client's shape (a colour code, "Land
// Here"), since that shape is what the cleaning is for.
import assert from 'node:assert/strict';
import {
  arrivalOf, BORROWED_POINTS, checkPointFrame, cleanText, cleanZoneTitle, clearanceOf, describedDistances, hyperspacePoints, INVENTED_FIELDS, INVENTED_POINTS,
  INVENTED_SCENERY, parseHyperspaceScene, placeScenery, scatterField, SPACE_PACK_VERSION, SPACE_ZONES, spaceZoneStatus, stationApproachEnd, stationStrings, warpTimings,
} from '../space.mjs';
import { parseIff } from '../iff.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';
import { PLANETS, planetBelow, spaceZoneOf } from '../../../src/data/planets.ts';
import {
  ALREADY_THERE, arrivalPose, brakeAt, distanceText, enterSpeed, EXIT_BRAKE, exitDistance, exitEnd, exitSpeed, exitTravelled, FALLBACK_SCENE, lookRotation, releaseAt,
  sceneOf, STATION_STANDOFF, toGame, trackedCruise, transitAt, veilUpAt, type JumpScene,
} from '../../../src/space/hyperspaceMath.ts';
import { arrivalAt, destinationsOf, HyperspaceCatalogue, landmarksOf, loadSpacePack, type SpacePack, type Vec3 } from '../../../src/space/spaceData.ts';
import { splitTrimesh } from '../../../src/world/trimeshPieces.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// 1. The jump scene.
const stage = (seconds: number, prt: string, cef: string, value: number, snd: string) => new W().f32(seconds).str(prt).str(cef).f32(value).str(snd).bytes();
const hypr = (...kids: ReturnType<typeof chunk>[]) => parseIff(Buffer.from(encode(form('HYPR', form('0000', ...kids)))));
const scene = parseHyperspaceScene(
  hypr(
    chunk('DATA', new W().f32(1.5).bytes()),
    chunk('STG1', stage(2.5, 'appearance\\enter.prt', 'clienteffect\\enter.cef', 7, 'sound\\in.snd')),
    chunk('STG2', new W().f32(20).f32(700).f32(0.25).str('sound\\mid.snd').bytes()),
    chunk('STG3', stage(4.5, 'appearance/exit.prt', 'clienteffect/exit.cef', 3, 'sound/out.snd')),
  ),
);
ok(!!scene && scene.scale === 1.5 && scene.enter.seconds === 2.5 && scene.exit.seconds === 4.5, 'the scene: its scale and the two stages\' seconds');
ok(!!scene && scene.enter.particle === 'appearance/enter.prt' && scene.enter.clientEffect === 'clienteffect/enter.cef' && scene.enter.value === 7 && scene.enter.sound === 'sound/in.snd', 'the enter stage\'s effect, client effect, value and sound, with slashes');
ok(!!scene && scene.exit.particle === 'appearance/exit.prt' && scene.exit.value === 3 && scene.exit.sound === 'sound/out.snd', 'the exit stage');
ok(!!scene && scene.transit.limit === 20 && scene.transit.speed === 700 && scene.transit.fade === 0.25 && scene.transit.sound === 'sound/mid.snd', 'the middle stage\'s three readings and its sound');
ok(parseHyperspaceScene(parseIff(Buffer.from(encode(form('HYPX', form('0000', chunk('DATA', new W().f32(1).bytes()))))))) === null, 'a form that is not HYPR gives null');
ok(parseHyperspaceScene(hypr(chunk('STG1', stage(1, 'a', 'b', 0, 'c')), chunk('STG3', stage(1, 'a', 'b', 0, 'c')))) === null, 'a scene missing its middle stage gives null');

// 2. Clean text.
ok(cleanText('\\#pcontrast3 Tatooine Space Station') === 'Tatooine Space Station', 'a colour code is stripped');
ok(cleanText('Quadrant I: Somewhere\n\nDistance to X: 5m') === 'Quadrant I: Somewhere\n\nDistance to X: 5m', 'line breaks survive');
ok(cleanZoneTitle('Kessel System (PvP Enabled)') === 'Kessel System' && cleanZoneTitle('Dathomir System (RESTRICTED)') === 'Dathomir System' && cleanZoneTitle('Karthakk System (Lok)') === 'Karthakk System (Lok)', 'a zone title loses the server\'s notes and keeps its own');

// 3. Station strings.
const sNames = new Map([
  ['tatooine_station_0', '\\#pcontrast3 Tatooine Space Station'],
  ['lok_station_0', '\\#pcontrast3 Lok Space Station'],
  ['corellia_station_0', '\\#pcontrast3 Corellia Space Station'],
]);
const sDescs = new Map([
  ['tatooine_station_0', 'Space Station, Land Here.'],
  ['lok_station_0', 'Lok Space Station. Land Here'],
  ['corellia_station_0', 'Corellia Space Station\n\nThis station can clear you for landing at any starport.'],
]);
const tat = stationStrings('station_tatooine', sNames, sDescs);
ok(tat.title === 'Tatooine Space Station' && tat.description === 'Space Station', 'a station takes its <planet>_station_0 strings, "Land Here" dropped');
ok(stationStrings('station_lok', sNames, sDescs).description === 'Lok Space Station.', '"X Station. Land Here" keeps its first sentence');
ok(stationStrings('station_corellia', sNames, sDescs).description === sDescs.get('corellia_station_0'), 'a longer description without the phrase is unchanged');
ok(stationStrings('spacestation_imperial', sNames, sDescs).title === 'Imperial station' && stationStrings('station_kashyyyk', sNames, sDescs).title === 'Kashyyyk Space Station', 'a station with no strings takes a title made from its name');

// 4. The points of a zone.
const rows = [
  { HYPERSPACE_POINT_NAME: 'space_alpha_1', SCENE: 'space_alpha', X: 100, Y: 0, Z: 0, REQUIRED_COMMAND: '' },
  { HYPERSPACE_POINT_NAME: 'space_alpha_0', SCENE: 'space_alpha', X: -300, Y: 20, Z: 50, REQUIRED_COMMAND: '' },
  { HYPERSPACE_POINT_NAME: 'space_beta_0', SCENE: 'space_beta', X: 9, Y: 9, Z: 9, REQUIRED_COMMAND: '' },
  { HYPERSPACE_POINT_NAME: 'space_nova_orion_0', SCENE: 'space_nova_orion', X: -500, Y: 100, Z: -200, REQUIRED_COMMAND: '' },
];
const pNames = new Map([
  ['space_alpha_0', 'Alpha: Quadrant I'],
  ['space_alpha_1', 'Alpha: Quadrant II'],
  ['space_alpha_2', 'Alpha: named but placed nowhere'],
  ['space_nova_orion_0', 'Ord Mantell: Somewhere'],
  ['space_heavy1_0', 'Deep Space: Unknown Regions / Quadrant I'],
  ['space_light1_0', 'Kessel: Quadrant I'],
]);
const pDescs = new Map([['space_alpha_0', 'Quadrant I: Alpha\n\nDistance to Alpha Space Station: 500m']]);
const alpha = hyperspacePoints('space_alpha', rows, pNames, pDescs);
ok(alpha.length === 2 && alpha[0].id === 'space_alpha_0' && alpha[1].id === 'space_alpha_1', 'only the zone\'s rows, sorted by id; a named id with no row is no point');
ok(alpha[0].source === 'table' && alpha[0].name === 'Alpha: Quadrant I' && alpha[0].description.startsWith('Quadrant I') && alpha[1].description === 'Alpha: Quadrant II', 'names and descriptions from the maps, a missing description the name');
const ord = hyperspacePoints('space_ord_mantell', rows, pNames, pDescs);
ok(ord.length === 1 && ord[0].id === 'space_nova_orion_0' && ord[0].source === 'borrowed' && ord[0].from === 'space_nova_orion' && ord[0].x === -500, 'Ord Mantell borrows its sister scene\'s row');
ok(BORROWED_POINTS.space_ord_mantell.includes('space_nova_orion_0'), 'the borrowing is listed');
const kessel = hyperspacePoints('space_light1', rows, pNames, pDescs);
ok(kessel.length === 4 && kessel.every((p) => p.source === 'invented') && kessel.map((p) => p.id).join(',') === 'space_light1_0,space_light1_1,space_light1_2,space_light1_3', 'Kessel gets its four made-up points, sorted');
ok(kessel[0].name === 'Kessel: Quadrant I' && kessel[1].name === 'space_light1_1', 'a made-up point takes its name from the map, else its id');
const deep = hyperspacePoints('space_heavy1', rows, pNames, pDescs);
ok(deep[0].name === 'Deep Space: Unknown Regions / Quadrant I' && deep.length === 4, 'Deep Space\'s names are kept as the table has them, on one line');

// 5. Described distances.
const dd = describedDistances('Quadrant I\n\nDistance to Yavin 4 Space Station: 12345m\n\nDistance to Kashyyyk space station: ~9.5km');
ok(dd.length === 2 && dd[0].station === 'station_yavin4' && dd[0].metres === 12345 && !dd[0].rough, 'an exact distance to a station');
ok(dd[1].station === 'station_kashyyyk' && dd[1].metres === 9500 && dd[1].rough, 'a rough distance in kilometres');
ok(describedDistances('Nothing here.').length === 0, 'a description with none gives none');

// 6. The frame check.
const stations = [
  { name: 'station_alpha', x: 2000, y: -500, z: 1000 },
  { name: 'station_beta', x: -3000, y: 700, z: -2500 },
];
const placed = [
  { at: [-4000, 900, 3000] },
  { at: [5000, -1200, -2000] },
  { at: [1500, 3000, -6000] },
];
const describe = (p: number[]) =>
  stations.map((s) => `Distance to ${s.name.slice(8)[0].toUpperCase()}${s.name.slice(9)} Space Station: ${Math.round(dist(p, [s.x, s.y, s.z]) + 120)}m`).join('\n') + '\nDistance to Beta Space Station: ~3km';
const framePoints = placed.map((p, i) => ({ id: `space_alpha_${i}`, description: describe(p.at), x: p.at[0], y: p.at[1], z: p.at[2] }));
const same = checkPointFrame(framePoints, stations);
ok(same.checked === 6 && same.sameCloser === 6 && same.mirroredCloser === 0 && same.meanErrorSame === 120 && same.meanErrorMirrored > 1000, 'points placed at their distances in the same frame fit the unmirrored pairing (rough ones skipped)');
const flipped = checkPointFrame(framePoints.map((p) => ({ ...p, x: -p.x })), stations);
ok(flipped.checked === 6 && flipped.mirroredCloser === 6 && flipped.sameCloser === 0, 'with the points\' X negated, the mirrored pairing fits');

// 7. Scenery placement.
const point = { x: 4000, y: 300, z: 3000 };
const spec = { distance: 1500, rise: 250 };
for (const radius of [100, 1900]) {
  const at = placeScenery(point, spec, radius);
  const across = Math.hypot(at.x - point.x, at.z - point.z);
  const want = Math.max(spec.distance, radius + 400);
  // The model's Z turned by q (a turn about Y: [w, 0, y, 0]).
  const [w, , qy] = at.q;
  const zx = 2 * w * qy;
  const zz = 1 - 2 * qy * qy;
  const lx = -point.x / Math.hypot(point.x, point.z);
  const lz = -point.z / Math.hypot(point.x, point.z);
  ok(Math.abs(across - want) < 1 && at.y === point.y + spec.rise, `scenery with a ${radius} m radius sits ${want} m across from its point, ${spec.rise} m above it`);
  ok(Math.abs(zx * lx + zz * lz) < 1e-3 && near(at.q[1], 0) && near(at.q[3], 0), 'its long axis lies across the line from the point');
  ok((at.x - point.x) * point.x + (at.z - point.z) * point.z < 0, 'toward the zone\'s middle');
}

// 8. The made-up contents are clear.
const heavyPoints = Object.entries(INVENTED_POINTS).filter(([id]) => id.startsWith('space_heavy1_'));
const lightPoints = Object.entries(INVENTED_POINTS).filter(([id]) => id.startsWith('space_light1_'));
const sd = INVENTED_SCENERY.space_heavy1[0];
const sdPoint = INVENTED_POINTS[sd.near as keyof typeof INVENTED_POINTS];
const sdAt = placeScenery({ x: sdPoint[0], y: sdPoint[1], z: sdPoint[2] }, sd, 2000);
ok(dist([sdAt.x, sdAt.y, sdAt.z], sdPoint) - 2000 >= 400, 'the Star Destroyer, taken as 2 km round, stays 400 m from its own point');
ok(heavyPoints.filter(([id]) => id !== sd.near).every(([, p]) => dist([sdAt.x, sdAt.y, sdAt.z], p) - 2000 >= 2000), 'and 2 km from every other Deep Space point');
const fields = INVENTED_FIELDS.space_heavy1;
ok(fields.every((f) => dist([sdAt.x, sdAt.y, sdAt.z], [f.CenterLocationX, f.CenterLocationY, f.CenterLocationZ]) > 2000 + f.Radius), 'its sphere meets neither made-up field');
const oneStyle = [{ SharedTemplate: 'object/static/test.iff', Likelihood: 1 }];
const rocks = fields.flatMap((f) => scatterField(f, oneStyle));
ok(rocks.length === fields.reduce((n, f) => n + f.NumAsteroids, 0), 'the made-up fields scatter every piece they ask for');
ok(heavyPoints.every(([, p]) => rocks.every((r) => dist([r.x, r.y, r.z], p) >= 300)), 'every Deep Space point is 300 m from every scattered piece');
ok(lightPoints.every(([, p]) => fields.every((f) => dist(p, [f.CenterLocationX, f.CenterLocationY, f.CenterLocationZ]) - f.Radius >= 300)), 'every Kessel point is clear of the made-up fields\' spheres');
ok(clearanceOf({ x: 0, y: 0, z: 0 }, [{ x: 100, y: 0, z: 0, radius: 30 }, { x: 0, y: 50, z: 0, radius: 60 }]) === -10 && clearanceOf([0, 0, 0], []) === Infinity, 'clearance is the nearest surface, Infinity with nothing placed');

// 9. Arrivals and station approaches.
const orbit = arrivalOf('space_tatooine', 'tatooine', alpha);
ok(orbit.kind === 'launch' && orbit.x === 0 && orbit.y === 0 && orbit.z === 0 && orbit.planet === 'tatooine', 'an orbit arrives at the origin, its launch point');
const kesselArrival = arrivalOf('space_light1', null, kessel);
ok(kesselArrival.kind === 'point' && kesselArrival.point === 'space_light1_0' && kesselArrival.x === INVENTED_POINTS.space_light1_0[0], 'a system of its own arrives at its first point');
const end = stationApproachEnd({ x: 3000, y: 0, z: 0, radius: 200 }, { x: 0, y: 0, z: 0 });
ok(near(end[0], 3000 - 200 - STATION_STANDOFF) && near(end[1], 0) && near(end[2], 0), 'a station\'s approach ends radius + 400 short of it on the line from the arrival');
const onTop = stationApproachEnd({ x: 10, y: 20, z: 30, radius: 382 }, { x: 10, y: 20, z: 30 });
ok(onTop[0] === 10 && onTop[1] === 20 && near(onTop[2], 30 + 782), 'a station on the arrival is approached along +Z');

// 10. The zone lists agree.
const spaceIds = PLANETS.filter((p) => p.space).map((p) => p.id).sort();
ok(spaceIds.join(',') === Object.keys(SPACE_ZONES).sort().join(','), 'the game\'s space zones are the converter\'s');
for (const [id, planet] of Object.entries(SPACE_ZONES)) {
  const z = PLANETS.find((p) => p.id === id)!;
  if (planet) ok(z.space === planet && planetBelow(z)?.id === planet && spaceZoneOf(planetBelow(z)!)?.id === id, `${id} is ${planet}'s orbit, both ways`);
  else ok(!!z.space && planetBelow(z) === null && !PLANETS.some((p) => p.id === z.space), `${id} is a system with nothing below`);
}
ok(planetBelow(PLANETS.find((p) => p.id === 'tatooine')!) === null, 'a ground planet has nothing below it');
ok(SPACE_PACK_VERSION === 2, 'space.json is version 2');

// 11. The runtime arithmetic.
ok(toGame([12, -3, 4]).join(',') === '-12,-3,4' && Object.is(toGame([0, 1, 2])[0], 0), 'toGame mirrors X only');
const synth: JumpScene = { enterSeconds: 2.4, exitSeconds: 5.6, speed: 750, fade: 0.3, limit: 25, enterPeak: 2.9, exitBurstAt: 3.7, exitClearAt: 4.8 };
let rising = true;
for (let t = 0, last = -Infinity; t <= 3; t += 0.05) {
  const v = enterSpeed(t, 50, synth);
  if (v < last - 1e-9) rising = false;
  last = v;
}
ok(rising && near(enterSpeed(0, 50, synth), 50) && near(enterSpeed(synth.enterSeconds, 50, synth), synth.speed) && near(enterSpeed(3, 50, synth), synth.speed), 'the enter speed rises from the ship\'s own to the leaving speed at the stage\'s end');
ok(near(exitSpeed(0, 60, synth), synth.speed) &&near(exitSpeed(EXIT_BRAKE, 60, synth), 60) && near(exitSpeed(3, 60, synth), 60), 'the exit speed falls to the ship\'s own at the brake\'s end and stays');
for (const u of [0.1, 0.3, 0.6, 1, 1.7]) {
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) sum += exitSpeed(((i + 0.5) / n) * u, 60, synth) * (u / n);
  ok(Math.abs(sum - exitTravelled(u, 60, synth)) <= 0.005 * sum, `the distance braked by ${u} s is the speed's integral`);
}
ok(near(exitDistance(60, synth), exitTravelled(EXIT_BRAKE, 60, synth)), 'the whole brake\'s distance');
ok(near(trackedCruise(0.5, exitTravelled(0.5, 60, synth), 60, synth), exitSpeed(0.5, 60, synth)) && trackedCruise(0.5, 1e6, 60, synth) === 0, 'on the curve the tracked cruise is the curve\'s; far ahead of it, nothing');
for (const s of [FALLBACK_SCENE, synth]) {
  ok(veilUpAt(s) < transitAt(s) && brakeAt(s) + EXIT_BRAKE <= releaseAt(s) && releaseAt(s) <= exitEnd(s), `the timeline is in order (${s === synth ? 'a scene' : 'the fallback'})`);
}
const pack0 = null;
ok(JSON.stringify(sceneOf(pack0)) === JSON.stringify(FALLBACK_SCENE), 'no pack: the fallback scene');
const towardStation = arrivalPose({ kind: 'point', at: [0, 0, 0], radius: 0 }, [{ at: [3000, 0, 0], radius: 300 }], null, 60, synth);
ok(near(towardStation.forward[0], 1) && near(dist(towardStation.start, towardStation.end), exitDistance(60, synth), 1e-6) && near(towardStation.start[0], -exitDistance(60, synth), 1e-6), 'a point faces the station 3 km off, and starts the brake\'s distance behind');
const toStation = arrivalPose({ kind: 'station', at: [1000, 0, 2000], radius: 250 }, [], [1000, 0, 0], 60, synth);
ok(near(toStation.end[0], 1000) && near(toStation.end[2], 2000 - 250 - STATION_STANDOFF) && near(toStation.forward[2], 1), 'a station: its end is radius + 400 short on the line from the approach, facing it');
const stationOnTop = arrivalPose({ kind: 'station', at: [5, 6, 7], radius: 100 }, [], [5, 6, 7], 60, synth);
const stationNull = arrivalPose({ kind: 'station', at: [5, 6, 7], radius: 100 }, [], null, 60, synth);
ok(near(stationOnTop.end[2], 7 + 100 + STATION_STANDOFF) && near(stationOnTop.forward[2], -1) && JSON.stringify(stationNull.end) === JSON.stringify(stationOnTop.end), 'a station on the approach, or no approach, is approached along +Z');
const nearby = arrivalPose({ kind: 'point', at: [0, 0, 50], radius: 0 }, [{ at: [0, 0, 100], radius: 10 }], null, 60, synth);
ok(near(nearby.forward[2], 1), 'nothing more than 100 m off and the origin close: facing +Z');
const fromOrigin = arrivalPose({ kind: 'launch', at: [0, 0, 5000], radius: 0 }, [], null, 60, synth);
ok(near(fromOrigin.forward[2], -1), 'no landmark: facing the origin');
const dirs: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [1, 1, 1], [-2, 0.5, -3]];
let rotOk = true;
for (const f of dirs) {
  const [x, y, z, w] = lookRotation(f);
  // Rotate (0, 0, 1) by q: v' = v + 2w(q x v) + 2 q x (q x v).
  const cx = y * 1 - z * 0, cy = z * 0 - x * 1, cz = 0;
  const ccx = y * cz - z * cy, ccy = z * cx - x * cz, ccz = x * cy - y * cx;
  const r = [0 + 2 * w * cx + 2 * ccx, 0 + 2 * w * cy + 2 * ccy, 1 + 2 * w * cz + 2 * ccz];
  const l = Math.hypot(...f);
  if (!(near(r[0], f[0] / l) && near(r[1], f[1] / l) && near(r[2], f[2] / l) && near(Math.hypot(x, y, z, w), 1))) rotOk = false;
}
ok(rotOk, 'lookRotation turns the nose onto eight directions, straight up and down among them');
ok(distanceText(850) === '850 m' && distanceText(12345) === '12.3 km' && ALREADY_THERE === 1000, 'distances read as the panel shows them');

// 12. Destinations and landmarks from a pack.
const pack: SpacePack = {
  version: 2,
  zone: 'space_test',
  planet: 'tatooine',
  title: 'Test System',
  stations: [{ name: 'station_test', title: 'Test Space Station', description: 'A station', model: 'm', x: -800, y: 0, z: 0, radius: 300, approachClearance: 500 }],
  scenery: [{ name: 'Wreck', template: 't', model: 'w', x: 10, y: 20, z: 30, q: [1, 0, 0, 0], radius: 50, near: 'space_test_0', invented: true }],
  planets: [],
  arrival: { x: 0, y: 0, z: 0, kind: 'launch', planet: 'tatooine' },
  hyperspace: {
    points: [
      { id: 'space_test_0', name: 'Test: Quadrant I', description: 'd', x: 1200, y: 50, z: -300, source: 'table', clearance: 900 },
      { id: 'space_test_1', name: 'Test: Quadrant II', description: 'e', x: 0, y: 0, z: 4000, source: 'invented', clearance: null },
    ],
    scene: null,
    effects: { enter: null, exit: null, timing: null },
    messages: { alreadyAtPoint: 'You are already at that point.' },
    frameCheck: { checked: 0, sameCloser: 0, mirroredCloser: 0, meanErrorSame: 0, meanErrorMirrored: 0 },
  },
};
// The scene from a pack, field by field (made-up figures), and a pack whose timings were not read.
const stageOf = (seconds: number) => ({ seconds, particle: 'p.prt', clientEffect: 'c.cef', value: 1, sound: 's.snd' });
const withScene: SpacePack = {
  ...pack,
  hyperspace: {
    ...pack.hyperspace!,
    scene: { source: 'scene/hyperspace.iff', scale: 1, enter: stageOf(2.6), transit: { limit: 28, speed: 820, fade: 0.35, sound: 's.snd' }, exit: stageOf(5.7) },
    effects: { enter: 'a.json', exit: 'b.json', timing: { enterPeak: 3.3, tunnelAt: 0.6, exitBurstAt: 4.1, exitClearAt: 5.3 } },
  },
};
const fromPack = sceneOf(withScene);
ok(fromPack.enterSeconds === 2.6 && fromPack.exitSeconds === 5.7 && fromPack.speed === 820 && fromPack.fade === 0.35 && fromPack.limit === 28, 'sceneOf takes the stages\' seconds and the middle stage\'s speed, fade and limit from the pack');
ok(fromPack.enterPeak === 3.3 && fromPack.exitBurstAt === 4.1 && fromPack.exitClearAt === 5.3, 'and the warp effects\' timings');
const noTiming = sceneOf({ ...withScene, hyperspace: { ...withScene.hyperspace!, effects: { enter: null, exit: null, timing: null } } });
ok(noTiming.enterSeconds === 2.6 && noTiming.speed === 820 && noTiming.enterPeak === FALLBACK_SCENE.enterPeak && noTiming.exitBurstAt === FALLBACK_SCENE.exitBurstAt && noTiming.exitClearAt === FALLBACK_SCENE.exitClearAt, 'a pack with no timings keeps its scene and takes the timings from the fallback');
const noSpeed = sceneOf({ ...withScene, hyperspace: { ...withScene.hyperspace!, scene: { ...withScene.hyperspace!.scene!, transit: { limit: 28, speed: 0, fade: 0.35, sound: '' } } } });
ok(noSpeed.speed === FALLBACK_SCENE.speed && noSpeed.limit === 28, 'an unusable reading falls back on its own, the rest kept');
const dests = destinationsOf(pack, 'Tatooine');
ok(dests.map((d) => d.kind).join(',') === 'point,point,station,launch' && dests.map((d) => d.key).join(',') === 'space_test:space_test_0,space_test:space_test_1,space_test:station_test,space_test:launch', 'points, then stations, then the launch point, keyed zone:id');
ok(!dests[0].invented && dests[1].invented && dests[2].radius === 300 && dests[3].name === 'Tatooine: launch point', 'made-up points flagged; a station keeps its radius; the launch point named for the planet');
ok(destinationsOf({ ...pack, arrival: { x: 1, y: 2, z: 3, kind: 'point', point: 'space_test_0' } }, null).every((d) => d.kind !== 'launch'), 'a system that is no orbit has no launch point');
ok(dests[0].at.join(',') === '1200,50,-300', 'a destination is in the client frame, as the pack has it');
const poseAtPoint = arrivalPose({ kind: dests[0].kind, at: toGame(dests[0].at), radius: 0 }, landmarksOf(pack), null, 60, synth);
ok(poseAtPoint.end.join(',') === '-1200,50,-300', 'through toGame and arrivalPose its end is mirrored in X');
ok(landmarksOf(pack)[0].at.join(',') === '800,0,0' && landmarksOf(pack).length === 2, 'a station at client (-800, 0, 0) is a landmark at game (800, 0, 0); scenery is one too');
ok(arrivalAt(pack)!.join(',') === '0,0,0' && arrivalAt(null) === null, 'the arrival in the game frame');
const cat = new HyperspaceCatalogue([{ id: 'space_test', name: 'Test orbit', title: 'Test System', pack, destinations: dests }]);
ok(cat.find('space_test:station_test')?.name === 'Test Space Station' && cat.find('nope') === null && cat.pack('space_test') === pack && cat.pack('other') === null, 'the catalogue finds a destination by key and a pack by zone');
const status = spaceZoneStatus('space_test', pack, 12);
ok(!status.stale && status.line === 'space_test: Test System, 1 station, 1 scenery, 12 objects, 2 hyperspace points (1 invented), arrival at launch point, no warp effects', 'the status line of a converted zone');
ok(spaceZoneStatus('space_old', { zone: 'space_old', stations: [] }, 3).stale && spaceZoneStatus('space_none', null, 0).stale, 'a missing pack or one converted before hyperspace wants the command');

// 14. The huge collider's pieces.
const side = 50; // a 50 x 100 grid of quads: 10,000 triangles
const verts: number[] = [];
for (let j = 0; j <= 100; j++) for (let i = 0; i <= side; i++) verts.push(i, (i * j) % 7, j);
const idx: number[] = [];
for (let j = 0; j < 100; j++) {
  for (let i = 0; i < side; i++) {
    const a = j * (side + 1) + i;
    idx.push(a, a + 1, a + side + 1, a + 1, a + side + 2, a + side + 1);
  }
}
const vArr = new Float32Array(verts);
const iArr = new Uint32Array(idx);
const pieces = splitTrimesh(vArr, iArr, 4000);
ok(pieces.length === 3 && pieces.map((p) => p.indices.length / 3).join(',') === '4000,4000,2000', '10,000 triangles split at 4,000 are three pieces of 4,000, 4,000 and 2,000');
ok(pieces.every((p) => p.indices.every((i) => i < p.vertices.length / 3)), 'every piece\'s indices are below its own vertex count');
let same3 = true;
let k = 0;
for (const p of pieces) {
  for (let i = 0; i < p.indices.length; i++, k++) {
    const a = p.indices[i];
    const b = iArr[k];
    if (p.vertices[a * 3] !== vArr[b * 3] || p.vertices[a * 3 + 1] !== vArr[b * 3 + 1] || p.vertices[a * 3 + 2] !== vArr[b * 3 + 2]) same3 = false;
  }
}
ok(same3 && k === iArr.length, 'the pieces\' triangles, mapped back to positions, are the original ones in order');
ok(pieces[2].vertices.length < vArr.length, 'a piece carries only the vertices it uses');

// 15. The warp effects' timings.
const wave = (points: number[][]) => ({ interp: 0, sample: 0, points: points.map(([t, v]) => [t, v, 0, 0]) });
const emitter = (o: { start: number; life: number; oneShot: boolean; shader: string; alpha: number[][]; visible?: boolean }) => ({
  timing: { startDelay: [o.start, o.start], loopDelay: [0, 0], loopCount: [0, 0] },
  lifeTime: wave([[0, o.life], [1, o.life]]),
  oneShot: o.oneShot,
  visible: o.visible ?? true,
  particle: { type: 'quad', alpha: wave(o.alpha), quad: { texture: { shader: o.shader, visible: true } } },
});
const enterFx = {
  groups: [
    {
      timing: null,
      emitters: [
        emitter({ start: 0, life: 5, oneShot: true, shader: 'shader/star.sht', alpha: [[0, 0], [0.4, 0.75], [0.7, 0.75], [1, 0]] }),
        emitter({ start: 0, life: 5, oneShot: true, shader: 'shader/star.sht', alpha: [[0, 0], [0.4, 1], [0.7, 1], [1, 0]] }),
        emitter({ start: 0.7, life: 6, oneShot: true, shader: '', alpha: [[0, 0], [0.1, 1], [1, 1]] }),
        emitter({ start: 6.5, life: 10, oneShot: false, shader: '', alpha: [[0, 1], [1, 1]] }),
        emitter({ start: 0, life: 9, oneShot: true, shader: 'shader/hidden.sht', alpha: [[0, 1], [1, 1]], visible: false }),
      ],
    },
  ],
};
const exitFx = {
  groups: [
    {
      timing: null,
      emitters: [
        emitter({ start: 3.6, life: 1.5, oneShot: true, shader: 'shader/star.sht', alpha: [[0, 0], [0.5, 1], [0.95, 1], [1, 0]] }),
        emitter({ start: 0, life: 6, oneShot: true, shader: '', alpha: [[0, 1], [0.8, 1], [1, 0]] }),
        emitter({ start: 0, life: 2.5, oneShot: false, shader: 'shader/glow.sht', alpha: [[0, 0], [0.2, 1], [1, 0]] }),
      ],
    },
  ],
};
const timing = warpTimings(enterFx, exitFx);
ok(timing.enterPeak === 3.5, 'the streaks\' alpha at its maximum to 70% of a 5 s life: the peak ends at 3.5 s');
ok(timing.tunnelAt === 0.7, 'the untextured quad starting at 0.7 s is the tunnel');
ok(timing.exitBurstAt === 3.6, 'the exit\'s one-shot streaks burst at 3.6 s');
ok(timing.exitClearAt === 4.8, 'the exit tunnel, opaque to 80% of 6 s, clears at 4.8 s');
const none = warpTimings({ groups: [] }, null);
ok(none.enterPeak === null && none.tunnelAt === null && none.exitBurstAt === null && none.exitClearAt === null, 'an effect with none of a kind gives null there');

// 16. The pack cache: a pack converted before hyperspace is fetched again, a converted one is kept.
const bodies: unknown[] = [
  { version: 1, zone: 'space_cache', stations: [] },
  { version: 2, zone: 'space_cache', title: 'Cache System', stations: [], hyperspace: { points: [] } },
  { version: 3, zone: 'space_cache', title: 'Never fetched', stations: [], hyperspace: { points: [] } },
];
let fetches = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  const body = bodies[Math.min(fetches++, bodies.length - 1)];
  return { ok: true, headers: { get: () => 'application/json' }, json: async () => body };
}) as unknown as typeof fetch;
try {
  const [a, b] = [loadSpacePack('/t/', 'space_cache'), loadSpacePack('/t/', 'space_cache')];
  ok(a === b, 'callers asking at the same moment share one fetch');
  const older = await a;
  ok(fetches === 1 && older !== null && older.hyperspace === null && older.version === 1, 'a pack from before hyperspace reads with hyperspace null');
  const newer = await loadSpacePack('/t/', 'space_cache');
  ok(fetches === 2 && newer?.hyperspace !== null && newer?.title === 'Cache System', 'it is not kept: the next load fetches again and sees the reconversion');
  const kept = await loadSpacePack('/t/', 'space_cache');
  ok(fetches === 2 && kept === newer, 'a converted pack is kept for the session');
} finally {
  globalThis.fetch = realFetch;
}

console.log(`${checks} checks passed`);
