// The space zones: stations by name, planets from a terrain file, and a field's asteroids scattered the same way every time.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dockEffects, fieldShapes, hardpointTurn, INVENTED_BODY_SIZE, laneNodes, parsePlanetAppearance, parseSpaceEnvironment, parseSpacePlanets,
  scatterField, seeded, SPACE_BODY_FRAME, spaceBody, spaceZoneStatus, stationTemplate, ZONE_MAP_ICONS, zoneIconPaths,
} from '../space.mjs';
import { parseIff } from '../iff.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

ok(stationTemplate('station_tatooine') === 'object/ship/shared_spacestation_neutral.iff' && stationTemplate('station_corellia').includes('corsec'), 'a station name maps to the faction station drawn for it');
ok(stationTemplate('station_unknown').includes('neutral'), 'an unknown station is the neutral one');

// A PLAN chunk as the retail terrain files write it: the appearance, eight floats (place, turn, halo roll,
// halo scale) and a byte; `flag` null leaves the byte off.
const plan = (name: string, f: number[], flag: number | null = 0) => {
  const w = f.reduce((acc, v) => acc.f32(v), new W().str(name));
  return form('PLAN', chunk('0000', (flag === null ? w : w.u8(flag)).bytes()));
};
const trn = parseIff(
  Buffer.from(
    encode(
      form('PTAT', form('0014', form('TGEN',
        // An orbit's planet with a halo (Tatooine's values), and its moon.
        plan('appearance/planet_tatooine.pln', [50, -520, 0, 0, 10, -30, 0, 2.4]),
        plan('appearance/planet_tatooine_moon.pln', [400, 120, -200, -50, 0, 0, 0, 0.95]),
        // Ord Mantell's: close, small, halo scale 0 (Kashyyyk's own planet is written the same way).
        plan('appearance/planet_ord_mantell.pln', [-86, 25, -90, 0, 0, 0, 0, 0]),
        plan('appearance/planet_ord_mantell_moon_02.pln', [-100, 42, -25, 45, 15, 15, 0, 0]),
        // No trailing byte: still a body.
        plan('appearance/planet_naboo_moon.pln', [150, 50, -200, -10, 30, -20, 30, 0.95], null),
      ))),
    ),
  ),
);
const planets = parseSpacePlanets(trn);
ok(planets.length === 5 && planets[0].appearance === 'appearance/planet_tatooine.pln' && planets[4].appearance === 'appearance/planet_naboo_moon.pln', 'the planets are read from the PLAN forms, with or without the trailing byte');
ok(planets[0].direction.join(',') === '50,-520,0' && planets[0].angles.join(',') === '0,10,-30' && Math.abs(planets[0].haloScale - 2.4) < 1e-6 && planets[4].haloRoll === 30, 'each with its place, its turn and its halo');
ok(planets[2].haloScale === 0 && planets[2].direction.join(',') === '-86,25,-90' && !('size' in planets[2]), 'the eighth float is the halo scale, not a size: 0 on Ord Mantell\'s bodies');

// Planet appearances (FORM PLNT > 0000): a planet with clouds and a halo, a bare moon, and a planet with clouds and no halo.
const surf = (spin: number, shader: string, radius: number, rest: number[]) => chunk('SURF', rest.reduce((w, v) => w.f32(v), new W().f32(spin).str(shader).f32(radius)).bytes());
const clod = (spin: number, shader: string, radius: number) => chunk('CLOD', new W().f32(spin).str(shader).f32(radius).f32(10).f32(10).bytes());
const halo = (shader: string, scale: number) => chunk('HALO', new W().str(shader).f32(scale).bytes());
const init = (a: number, b: number) => chunk('INIT', new W().i32(a).i32(b).bytes());
const pln = (...children: ReturnType<typeof chunk>[]) => parseIff(Buffer.from(encode(form('PLNT', form('0000', ...children)))));
const tatooine = parsePlanetAppearance(pln(init(64, 32), surf(0.005, 'shader/pln_tatooine_detail.sht', 390, [80, 80, 10, 10]), clod(0.15, 'shader/pln_cloud2.sht', 391), halo('shader/planet_halo.sht', 1.24)));
const bareMoon = parsePlanetAppearance(pln(init(24, 24), surf(0.85, 'shader\\pln_tatooine.sht', 16, [2, 2, 4, 4])));
const ordMantell = parsePlanetAppearance(pln(init(64, 32), surf(0.15, 'shader/pln_ord_mantell.sht', 50, [4, 4, 16, 16]), clod(0.3, 'shader/pln_cloud_ord_mantell.sht', 50.25)));
const tinyMoon = parsePlanetAppearance(pln(init(16, 8), surf(0.85, 'shader/pln_ord_mantell_moon_2_sm.sht', 1, [2, 2, 2, 2])));
ok(tatooine!.radius === 390 && tatooine!.shader === 'shader/pln_tatooine_detail.sht' && tatooine!.clouds!.radius === 391 && tatooine!.halo!.scale === 1.24, 'a planet appearance: the surface shader and radius, the cloud shell, the halo');
ok(bareMoon!.radius === 16 && bareMoon!.shader === 'shader/pln_tatooine.sht' && bareMoon!.clouds === null && bareMoon!.halo === null, 'a bare moon: a surface and nothing else, the path\'s slashes turned');
ok(ordMantell!.radius === 50 && ordMantell!.clouds!.shader.endsWith('pln_cloud_ord_mantell.sht') && ordMantell!.halo === null, 'a planet with clouds and no halo');
const bareHalo = parsePlanetAppearance(pln(init(24, 24), surf(0.85, 'shader/pln_tatooine.sht', 16, [2, 2, 4, 4]), chunk('HALO', new W().str('shader/planet_halo.sht').bytes())));
ok(bareHalo!.halo!.shader === 'shader/planet_halo.sht' && bareHalo!.halo!.scale === null, 'a halo chunk that stops after its shader has no scale, not an invented one');
ok(parsePlanetAppearance(pln(init(64, 32))) === null &&parsePlanetAppearance(parseIff(Buffer.from(encode(form('MESH', form('0005')))))) === null, 'no surface, or not a planet appearance: null');

// A body's size: its radius over its distance, in the game's unit, so it covers as much sky as the client's.
const unit = SPACE_BODY_FRAME.distance / SPACE_BODY_FRAME.radius;
const tat = spaceBody(planets[0], tatooine, 'space/planet_tatooine.png');
ok(tat.radius === 390 && Math.abs(tat.distance - Math.hypot(50, 520)) < 0.01 && Math.abs(tat.size - (390 / Math.hypot(50, 520)) * unit) < 1e-3 && tat.sizeFrom === 'appearance', `Tatooine's size is its radius over its distance (${tat.size})`);
ok(Math.abs(Math.asin((SPACE_BODY_FRAME.radius * tat.size) / SPACE_BODY_FRAME.distance) - Math.asin(390 / Math.hypot(50, 520))) < 1e-3, 'drawn in the game\'s frame it covers the angle it covers in the client\'s');
ok(tat.halo !== null && tat.halo.scale === 2.4 && tat.halo.shader === 'shader/planet_halo.sht' && tat.texture === 'space/planet_tatooine.png' && tat.direction.join(',') === '50,-520,0', 'the halo, the texture and the place ride along');
const om = spaceBody(planets[2], ordMantell);
const omMoon = spaceBody(planets[3], tinyMoon);
ok(om.size > 0 && Math.abs(om.size - (50 / Math.hypot(86, 25, 90)) * unit) < 1e-3 && om.halo === null, `Ord Mantell has a size although its halo scale is 0 (${om.size})`);
ok(omMoon.size > 0 && omMoon.size < om.size / 20, `its small moon is a speck beside it (${omMoon.size})`);
const lost = spaceBody(planets[4], null);
ok(lost.radius === null && lost.size === INVENTED_BODY_SIZE && lost.sizeFrom === 'invented', 'a body with no appearance is given the invented size, and says so');

// The game's unit is world.ts's own.
const worldTs = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
const constant = (name: string) => Number(new RegExp(`const ${name} = ([\\d.]+);`).exec(worldTs)?.[1]);
ok(constant('SPACE_BODY_DISTANCE') === SPACE_BODY_FRAME.distance && constant('SPACE_BODY_SIZE') === SPACE_BODY_FRAME.radius, 'SPACE_BODY_FRAME is the frame the game draws the bodies in');

// A pack whose bodies were sized from the halo's scale asks for the space command again.
const packOf = (planets: object[]) => ({ version: 3, zone: 'space_test', title: 'Test', stations: [], planets, hyperspace: { points: [] } });
ok(spaceZoneStatus('space_test', packOf([{ appearance: 'a.pln', direction: [0, -1, 0], size: 0 }]), 0).stale, 'bodies with no radius: converted before the sizes were read');
ok(!spaceZoneStatus('space_test', packOf([tat, lost]), 0).stale && !spaceZoneStatus('space_test', packOf([]), 0).stale, 'bodies with a radius, or with a null one, or none at all: up to date');

// The zone's environment forms, laid out as the client's terrain files have them.
const argb = (w: W, a: number, r: number, g: number, b: number) => w.f32(a).f32(r).f32(g).f32(b);
const para = (shadows: number, d: number[], s: number[], ypr: number[]) => form('PARA', chunk('0000', ypr.reduce((w, v) => w.f32(v), argb(argb(new W().u8(shadows), d[0], d[1], d[2], d[3]), s[0], s[1], s[2], s[3])).bytes()));
const cele = (shader: string, size: number, ypr: number[]) => form('CELE', chunk('0000', ypr.reduce((w, v) => w.f32(v), new W().str(shader).f32(size).f32(0).u8(0)).bytes()));
const env = parseSpaceEnvironment(
  parseIff(
    Buffer.from(
      encode(
        form(
          'PTAT',
          form(
            '0014',
            form('TGEN',
              form('CLEA', chunk('0000', new W().f32(0).f32(0).f32(0.3).bytes())),
              form('SKYB', chunk('0000', new W().u8(0).str('nebula2').bytes())),
              form('AMBI', chunk('0000', argb(new W(), 1, 0.35, 0.28, 0.35).bytes())),
              para(1, [1, 1.15, 0.9, 0.75], [1, 1.75, 1, 0.5], [-135, -45, -50]),
              para(0, [1, 0.6, 0.2, 0.3], [1, 0, 0, 0], [-80, 180, 0]),
              form('ENVI', chunk('0000', new W().str('texture/env_space_tato.dds').bytes())),
              form('STAR', chunk('0000', new W().str('terrain/colorramp/stars_tato.tga').i32(24000).bytes())),
              form('DUST', chunk('0000', new W().i32(750).f32(64).bytes())),
              cele('shader/cels_star_back.sht', 0.5, [-21, -30, -71]),
              cele('shader/starglow_radial.sht', 0.25, [-21, -30, -71]),
            ),
          ),
        ),
      ),
    ),
  ),
);
ok(env.skybox === 'nebula2' && env.environmentMap === 'texture/env_space_tato.dds', 'the skybox name and the reflection cube map are read');
ok(env.clear!.map((v) => Number(v.toFixed(2))).join(',') === '0,0,0.3' && env.ambient!.map((v) => Number(v.toFixed(2))).join(',') === '0.35,0.28,0.35', 'the clear and ambient colours, the alpha dropped');
ok(env.lights.length === 2 && env.lights[0].shadows && !env.lights[1].shadows && env.lights[0].diffuse.map((v) => Number(v.toFixed(2))).join(',') === '1.15,0.9,0.75' && env.lights[0].yaw === -135 && env.lights[0].pitch === -45 && env.lights[1].pitch === 180, 'the parallel lights with their colours and angles');
ok(env.stars!.count === 24000 && env.stars!.colorRamp.endsWith('stars_tato.tga') && env.dust!.count === 750 && env.dust!.radius === 64, 'the star field and the dust');
ok(env.celestials.length === 2 && env.celestials[0].size === 0.5 && env.celestials[0].yaw === -21 && env.celestials[0].pitch === -30 && env.celestials[0].roll === -71 && env.celestials[1].shader.endsWith('starglow_radial.sht'), 'the star sprites with their sizes and angles');

const rng = seeded(5555);
const a = [rng(), rng(), rng()];
const rng2 = seeded(5555);
ok(a.every((v, i) => v === rng2() && v >= 0 && v < 1), 'the seeded generator repeats itself');

const styles = [{ SharedTemplate: 'object/static/space/asteroid/shared_a.iff', Likelihood: 1 }, { SharedTemplate: 'object/static/space/asteroid/shared_b.iff', Likelihood: 3 }];
const sphere = { Type: 1, CenterLocationX: 100, CenterLocationY: -50, CenterLocationZ: 2000, Radius: 300, NumAsteroids: 200, RandomSeed: 7, ScaleMin: 1, ScaleMax: 2 };
const field = scatterField(sphere, styles);
ok(field.length === 200, 'a sphere field has its count');
ok(field.every((o) => Math.hypot(o.x - 100, o.y + 50, o.z - 2000) <= 300.001), 'every asteroid lies within the radius of the centre');
ok(field.every((o) => o.scale >= 1 && o.scale <= 2 && Math.abs(Math.hypot(...o.q) - 1) < 1e-3), 'scales within the range, turns unit quaternions');
const bs = field.filter((o) => o.template.endsWith('shared_b.iff')).length;
ok(bs > 120 && bs < 180, `the likelier style is picked about three times in four (${bs} of 200)`);
ok(JSON.stringify(scatterField(sphere, styles)) === JSON.stringify(field), 'the same seed scatters the same field');

const tube = { Type: 2, SplineControlPoints: '0,0,0:1000,0,0:1000,0,1000', CenterLocationX: 0, CenterLocationY: 0, CenterLocationZ: 0, Radius: 50, NumAsteroids: 100, RandomSeed: 3, ScaleMin: 1, ScaleMax: 1 };
const along = scatterField(tube, styles);
const near = along.filter((o) => (Math.abs(o.y) <= 50 && o.x >= -50 && o.x <= 1050 && (Math.abs(o.z) <= 50 || (Math.abs(o.x - 1000) <= 50 && o.z >= -50 && o.z <= 1050)))).length;
ok(near === 100, 'a spline field keeps to the tube round its line');
ok(scatterField({ ...sphere, NumAsteroids: 5000 }, styles).length === 400, 'a field is capped');

// A field's shape, for the map: the asteroids are scattered elsewhere, this is the sphere or the tube.
const shapes = fieldShapes([
  [{ ...sphere, Name: '', SoundEffect: 'sound\\amb_field.snd', MaxViewableDistance: 7000, ViewAllDistance: 3000, FlattenDepth: -1, FaceTowards: '' }, false],
  [{ ...tube, Name: 'A belt', SoundEffect: '' }, true],
]);
ok(shapes.length === 2 && shapes[0].kind === 'sphere' && shapes[1].kind === 'spline', 'a field with a spline is a tube, one without it a sphere');
ok(shapes[0].at.join(',') === '-100,-50,2000' && shapes[0].radius === 300 && shapes[0].count === 200, 'a sphere field\'s centre is mirrored into the game\'s frame, with its radius and count');
ok(shapes[1].spline.length === 3 && shapes[1].spline[1].join(',') === '-1000,0,0' && Object.is(shapes[1].spline[0][0], 0), 'every spline point is mirrored too, a zero staying plain');
ok(shapes[0].name === null && shapes[1].name === 'A belt', 'an empty Name column is null; the column is filled on 70 of the 214 retail rows and empty on the rest');
ok(shapes[0].sound === 'sound/amb_field.snd' && shapes[1].sound === null && shapes[0].viewFrom === 7000 && shapes[0].viewAll === 3000 && shapes[0].flattenDepth === -1, 'the sound, both view distances and the unread columns ride along');
ok(shapes[1].viewFrom === null && shapes[1].viewAll === null, 'a row with no view distance carries null, not a zero that would read as "never draw this"');
ok(!shapes[0].invented && shapes[1].invented, 'a made-up field says so');
ok(fieldShapes(null as never).length === 0, 'no fields at all is no shapes');

// Docking lanes, shaped like the ones the retail stations carry: a full lane, a lane whose approach
// numbers start at 2 with a gap, a bare dock with no approach or exit, and the drydocks beside them.
const hp = (name: string, at: number[], matrix: number[] | null = null) => ({ name, position: at, matrix });
const yawQuarter = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0]; // the model's Z turned onto its X
const station = laneNodes([
  hp('approach_a_1', [10, 0, 60]),
  hp('approach_a_4', [10, 0, 200]),
  hp('approach_a_3', [10, 0, 150]),
  hp('dock_a', [10, 0, 20], yawQuarter),
  hp('dockradius_a', [10, 0, 0]),
  hp('exit_a_1', [10, 0, -20]),
  hp('exit_a_2', [10, 0, -90]),
  hp('approach_b_2', [-30, 5, 60]),
  hp('approach_b_10', [-30, 5, 400]),
  hp('dock_b', [-30, 5, 20]),
  hp('dock_c', [-50, 5, 20]),
  hp('dockradius_c', [-50, 5, 5]),
  hp('dockradius_d', [-80, 5, 5]),
  hp('drydock2', [200, 0, 0]),
  hp('drydock1', [-200, 0, 0]),
  hp('hangar2', [0, -40, -100]),
  hp('hangar1', [40, -40, -100]),
  hp('bigship_hangar', [0, 30, -700]),
  hp('hangar_damage1', [0, -40, -100]),
  hp('bridge1', [0, 0, 0]),
]);
ok(!!station && station.lanes.map((l) => l.lane).join(',') === 'a,b,c', 'the lanes come out in order, one per letter');
ok(station!.lanes[0].approach.map((p) => p.n).join(',') === '1,3,4' && station!.lanes[1].approach.map((p) => p.n).join(',') === '2,10', 'each lane\'s points keep the numbers their hardpoints carry, gaps and all');
ok(station!.lanes[0].dock!.at.join(',') === '-10,0,20' && station!.lanes[0].approach[0].at.join(',') === '-10,0,60', 'a lane point is mirrored in X exactly as the model\'s meshes are');
ok(station!.lanes[0].dockRadius === 20 && station!.lanes[2].dockRadius === 15 && station!.lanes[1].dockRadius === null, 'the dock radius is how far its own point is from the dock; a lane without one has none');
ok(station!.lanes[2].approach.length === 0 && station!.lanes[2].exit.length === 0 && !!station!.lanes[2].dock, 'a bare dock with no approach and no exit is still a lane');
ok(station!.lanes[0].exit.map((p) => p.n).join(',') === '1,2' && station!.lanes[1].exit.length === 0, 'the exits are their own list');
ok(station!.drydocks.map((d) => d.name).join(',') === 'drydock1,drydock2', 'the drydocks come along, in name order');
ok(station!.bays.map((b) => b.name).join(',') === 'bigship_hangar,hangar1,hangar2', 'the hangar mouths come along too, whatever a model calls them, and the damage points do not');
ok(station!.bays[2].at.join(',') === '0,-40,-100', 'a bay is mirrored with the model like everything else');
ok(laneNodes([hp('bridge1', [0, 0, 0])]) === null && laneNodes([]) === null, 'a model with no lane points at all has no lanes');
ok(laneNodes([hp('hangar1', [1, 2, 3])])!.bays.length === 1, 'a model carrying only a hangar mouth still has something to say');
const turned = station!.lanes[0].dock!;
ok(turned.forward.join(',') === '-1,0,0' && Math.abs(turned.q[0] - Math.cos(Math.PI / 4)) < 1e-3 && Math.abs(turned.q[2] + Math.sin(Math.PI / 4)) < 1e-3, 'a dock\'s turn is mirrored with the model: a quarter turn one way becomes a quarter turn the other');
ok(hardpointTurn(null).join(',') === '1,0,0,0' && hardpointTurn([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]).join(',') === '1,0,0,0', 'a hardpoint with no matrix, or the identity, has no turn');
const unmirrored = laneNodes([hp('dock_a', [10, 0, 20], yawQuarter)], false);
ok(unmirrored!.lanes[0].dock!.at.join(',') === '10,0,20' && unmirrored!.lanes[0].dock!.forward.join(',') === '1,0,0', 'without the mirror the point and its forward are the model\'s own');
ok(station!.lanes.length === 3 && !station!.lanes.some((l) => l.lane === 'd'), 'a dock radius with no dock of its own does not conjure a lane nothing can dock at');
ok(station!.lanes[0].approach.map((p) => p.fromDock).join(',') === '40,130,180' && station!.lanes[0].exit[1].fromDock === 110, 'every approach and exit point says how far it is from its own dock');
ok(station!.lanes[1].approach.every((p) => typeof p.fromDock === 'number') && laneNodes([hp('approach_z_1', [0, 0, 9])])!.lanes[0].approach[0].fromDock === null, 'a lane with no dock at all can measure nothing, so its points say null');

// One station numbers a single letter over more than one path, so the numbers do not rise with the
// distance across the lane as a whole: 10 stands nearest the dock and 6 begins the other path. The
// converter keeps them as they are; `fromDock` is what a reader groups and orders them by.
const twoPaths = laneNodes([
  hp('dock_a', [0, 0, 0]),
  hp('approach_a_10', [0, 0, -76]),
  hp('approach_a_2', [0, 0, -226]),
  hp('approach_a_3', [0, 0, -429]),
  hp('approach_a_6', [0, 0, 114]),
  hp('approach_a_7', [0, 0, 245]),
])!.lanes[0];
ok(twoPaths.approach.map((p) => p.n).join(',') === '2,3,6,7,10', 'the points stay in the order their numbers give, however the paths run');
ok(twoPaths.approach.map((p) => p.fromDock).join(',') === '226,429,114,245,76', 'so the distances do not rise with the numbers, and flying the highest number first would start at the dock');
const path = (points: { n: number; fromDock: number | null; at: number[] }[], sign: number) => points.filter((p) => Math.sign(p.at[2]) === sign).sort((a, b) => a.n - b.n).map((p) => p.fromDock);
ok(path(twoPaths.approach, -1).join(',') === '226,429,76' && path(twoPaths.approach, 1).join(',') === '114,245', 'split by the path they lie on, each one\'s numbers do rise outward apart from the tacked-on near point');

// The mirror, worked out from first principles rather than copied: turning the model's Z onto its X
// and then mirroring X is the same as turning its Z onto its -X, so the quaternion's sign flips.
const axisAngle = (q: number[]) => [Math.round(2 * Math.acos(Math.min(1, Math.abs(q[0]))) * 1000) / 1000, Math.sign(q[2])];
ok(axisAngle(hardpointTurn(yawQuarter, false)).join(',') === `${Math.round((Math.PI / 2) * 1000) / 1000},1`, 'unmirrored, a quarter turn about Y stays a quarter turn about +Y');
ok(axisAngle(hardpointTurn(yawQuarter, true)).join(',') === `${Math.round((Math.PI / 2) * 1000) / 1000},-1`, 'mirrored, the same quarter turn goes the other way about Y');
ok(hardpointTurn([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0], true)[0] === hardpointTurn(yawQuarter, false)[0], 'the mirror of one quarter turn is the other, whichever way round it is read');

// What a dock plays. Every retail dock effect names a sound and no particle at all.
const fx = dockEffects((source: string) => (source.includes('reload') ? null : { particles: [], sounds: [`sound/${source.replace(/^.*\//, '').replace(/\.cef$/, '')}.snd`] }));
ok(fx.harddock.sound === 'sound/shp_dock_harddock.snd' && fx.harddock.particle === null, 'a dock effect comes down to its sound');
ok(!('reload' in fx) && 'repair' in fx && 'release' in fx, 'an effect the archives do not hold is left out');

// The zone map's icons.
ok(ZONE_MAP_ICONS.length === 6 && zoneIconPaths('nebula').texture.endsWith('ui_space_zone_nebula.dds') && zoneIconPaths('nebula').file === 'space_ui/zone_nebula.png', 'the six zone-map icons, each from its own texture into the shared folder');

// A zone converted before the nebulae asks for the space command again; one with them says what it has.
const full = {
  version: 3, zone: 'space_test', title: 'Test System', stations: [{ name: 's' }], scenery: [], planets: [], arrival: { kind: 'launch' },
  nebulae: [{ shader: 'glow', lightning: {} }, { shader: 'mist', lightning: null }],
  fields: [{}, {}, {}],
  lanes: { m: { lanes: [{ lane: 'a' }, { lane: 'b' }], drydocks: [], bays: [] } },
  hyperspace: { points: [{ source: 'table' }], effects: { enter: 'a', exit: 'b' }, frameCheck: { checked: 0, sameCloser: 0, mirroredCloser: 0 } },
};
const v3 = spaceZoneStatus('space_test', full, 40);
ok(!v3.stale && v3.line.includes('2 nebulae (1 with lightning), 3 fields, 2 docking lanes'), `the status line says what version 3 added (${v3.line})`);
ok(spaceZoneStatus('space_test', { ...full, version: 2 }, 40).stale, 'a pack at version 2 wants the space command again');
ok(spaceZoneStatus('space_test', { version: 1, zone: 'z', stations: [] }, 0).line.includes('before hyperspace'), 'a pack older still says so in its own words');

console.log(`${checks} checks passed`);
