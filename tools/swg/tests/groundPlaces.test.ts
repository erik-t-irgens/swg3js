// A ground sky's place he moved or sized on the viewer's Place tab reaches the game (the GPU port's pass 2, wave 6, maker K):
// the viewer's Save to game (`viewer/gameBodies.mjs`' `groundPlacesForGame`) writes SWG's slots' and celestials' sizes and a
// celestial's (or a second body's) yaw and pitch, the game's reader keeps them (`bodiesFile.ts`, where the base's reader dropped
// every place but a space one), and `groundPlaces.ts` lays them over the sky file before the sky is made (`World.loadSky`).
//
// Run: node tools/swg/tests/groundPlaces.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { atBase } from './atBase.ts';
// @ts-ignore a plain module of the viewer's
import { gameBodiesFile } from '../../../viewer/gameBodies.mjs';
import { cleanBodiesFile } from '../../../src/sky/look/bodiesFile.ts';
import { groundPlacesMix, sizeOfDegrees } from '../../../src/sky/look/groundPlaces.ts';
import { skyPlacesOf, squareDegrees } from '../../../src/sky/system/skyMotion.ts';
import type { SkyData } from '../../../src/world/sky.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, e = 1e-9): boolean => Math.abs(a - b) <= e;

// A stand-in of Rori's sky file: a sun, a moon, Naboo and two of one moon picture (made-up numbers; no converted file read).
const cel = (file: string, size: number, yaw: number, pitch: number): Any => ({ shader: 's', size, glowShader: 'g', glowSize: size * 1.5, image: { file, alphaMode: 'BLEND' }, glowImage: { file: file + '_glow' }, yaw, pitch });
const DATA = {
  planet: 'rori',
  dayNightSplit: 0.7,
  sunElevationDegrees: 67.5,
  sun: cel('sky/sun_rori.png', 0.5, 0, 0),
  supplementalSun: null,
  moon: cel('sky/moon_rori.png', 0.3, 0, 0),
  supplementalMoon: null,
  celestials: [cel('sky/cels_naboo.png', 1, 120, 40), cel('sky/cels_moon.png', 0.2, 10, 20), cel('sky/cels_moon.png', 0.25, 200, 30)],
  blocks: [],
} as unknown as SkyData;

const edits = {
  'rori:celestial:cels_naboo': { yaw: 95, pitch: 52, size: 30, tilt: 4, light: { source: 'fixed' } },
  'rori:celestial:cels_moon#2': { size: 9 },
  'rori:moon': { size: 12, yaw: 33 },
  'space_naboo:planet_naboo': { yaw: 10, size: 20 },
  'tatooine:sun': { size: 8 },
};
const made = JSON.parse(JSON.stringify(gameBodiesFile({ looks: {}, uses: {}, places: edits }, { at: 'now' })));
ok(made.places['rori:celestial:cels_naboo']?.yaw === 95 && made.places['rori:celestial:cels_naboo'].tilt === undefined && made.places['rori:moon']?.size === 12 && made.places['rori:moon'].yaw === undefined && made.places['space_naboo:planet_naboo']?.yaw === 10, "Save to game writes a ground place's size and a celestial's direction (a sun's or moon's own direction is the day's: its size alone), beside the space places");

const base = await atBase<{ cleanBodiesFile: typeof cleanBodiesFile }>('src/sky/look/bodiesFile.ts', '1b2a6c6');
ok(!!base && !base.cleanBodiesFile(made).file!.places['rori:celestial:cels_naboo'] && !!base.cleanBodiesFile(made).file!.places['space_naboo:planet_naboo'], "the base's reader (1b2a6c6) dropped every ground place: none reached the game");
const file = cleanBodiesFile(made).file!;
ok(file.places['rori:celestial:cels_naboo']?.pitch === 52 && file.places['tatooine:sun']?.size === 8 && file.places['space_naboo:planet_naboo']?.yaw === 10, "today's reader keeps them");

const mix = groundPlacesMix('rori', file.places)!;
const laid = mix(DATA);
const naboo = laid.celestials[0] as Any;
ok(naboo.yaw === 95 && naboo.pitch === 52 && near(squareDegrees(naboo.size), 30) && near(naboo.glowSize / naboo.size, 1.5), `Naboo in Rori's sky stands at his yaw 95 and pitch 52, ${squareDegrees(naboo.size).toFixed(6)} degrees across, its glow its share of the disc`);
ok(near(squareDegrees((laid.celestials[2] as Any).size), 9) && (laid.celestials[1] as Any).size === 0.2 && (laid.celestials[2] as Any).yaw === 200, 'the second of a repeated picture is `#2`, sized alone; the first left as it was');
ok(near(squareDegrees((laid.moon as Any).size), 12) && (laid.moon as Any).yaw === 0 && laid.sun === DATA.sun, "the moon slot takes his size and keeps the day's direction; the sun untouched");
ok(near(skyPlacesOf('rori', laid as Any).get('rori:celestial:cels_naboo')!.sizeDeg, 30), "and the motion's places read his size, so an applied system's own rules start from it");
ok(JSON.stringify(DATA.celestials[0]) === JSON.stringify(cel('sky/cels_naboo.png', 1, 120, 40)), "the sky file's own data is not written: the laid sky is a copy");
ok(groundPlacesMix('naboo', file.places) === null && groundPlacesMix('rori', null) === null, 'a world the file names no ground place of, or no file: no hook at all, the sky as it was');
ok([0.5, 5, 30, 120].every((d) => near(squareDegrees(sizeOfDegrees(d)), d)), "the size goes back through SWG's square to the very degrees");

const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
ok(world.includes('placed = groundPlacesMix(basePack);') && world.includes("const sky = await SwgSky.load(pack, placed ? (d) => placed!(mix ? mix(d) : d) : (mix ?? undefined));"), "the world lays them over its sky file before the sky is made, on WebGPU (the file's own path), over a sky of parts' mix");

console.log(`\ngroundPlaces: ${checks} checks passed`);
