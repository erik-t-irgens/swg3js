// The space zones: stations by name, planets from a terrain file, and a field's asteroids scattered the same way every time.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INVENTED_BODY_SIZE, parsePlanetAppearance, parseSpaceEnvironment, parseSpacePlanets, scatterField, seeded, SPACE_BODY_FRAME, spaceBody, spaceZoneStatus, stationTemplate } from '../space.mjs';
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
const packOf = (planets: object[]) => ({ version: 2, zone: 'space_test', title: 'Test', stations: [], planets, hyperspace: { points: [] } });
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
console.log(`${checks} checks passed`);
