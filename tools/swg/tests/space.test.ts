// The space zones: stations by name, planets from a terrain file, and a field's asteroids scattered the same way every time.
import assert from 'node:assert/strict';
import { parseSpaceEnvironment, parseSpacePlanets, scatterField, seeded, stationTemplate } from '../space.mjs';
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

const plan = (name: string, f: number[]) => form('PLAN', chunk('0000', f.reduce((w, v) => w.f32(v), new W().str(name)).bytes()));
const trn = parseIff(Buffer.from(encode(form('PTAT', form('0014', form('TGEN', plan('appearance/planet_tatooine.pln', [50, -520, 0, 0, 10, -30, 0, 2.4]), plan('appearance/planet_tatooine_moon.pln', [400, 120, -200, -50, 0, 0, 0, 0.95])))))));
const planets = parseSpacePlanets(trn);
ok(planets.length === 2 && planets[0].appearance === 'appearance/planet_tatooine.pln', 'the planets are read from the PLAN forms');
ok(planets[0].direction.join(',') === '50,-520,0' && Math.abs(planets[0].size - 2.4) < 1e-6 && Math.abs(planets[1].size - 0.95) < 1e-6, 'each with its direction and size');

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
