// The GPU port's pass 2, wave 1, what draws from the air (maker B), held in node as far as node reaches. Node builds no WGSL and
// draws nothing, so the pictures are a browser's; here, every time the game's own code:
//  1. the star table (`src/sky/stars.ts`): Naboo and Rori one star, Hoth's blue-white, Tatooine's pair, every caster at 1, a
//     black body's colour (luminance one, near white at 6,500 K, warm below and blue above);
//  2. Tatooine's pair rule: the second sun `PAIR_TUNE.belowDeg` under the caster on its own azimuth, and over a whole day of
//     `DayCycle` itself it rises after the caster and sets before it; the dial moves it;
//  3. `__debug.sky`'s hours (`skyHours.ts`) against `DayCycle.update` itself, on SWG's own path and on the plain arc;
//  4. the night floor (`nightFloor.ts`): nought by day, the share by night, every light held at no less than SWG's times it;
//  5. the sky's dials (`skyDials.ts`), each set through `tuneSky`, held to its range;
//  6. the Sky row (`skyMode.ts`): read once, WebGL always SWG's, the storage's word, the row's note;
//  7. the haze's arithmetic (`airHazeMath.ts`): the see-through layer and the pass equal every layer drawn the old way and hazed
//     at its own distance, for every blend that goes into the layer; the kinds read off three's own materials; the distances
//     against three's own camera; the reach's extension;
//  8. the layer's blends (`airSee.ts`) worked as the GPU blends them give the rule's stack, and the motion node hands them out;
//  9. the graphs build over the pass's own records and a stand-in of the air's tables, and their text reads no world place and
//     takes no sample inside a branch;
// 10. the haze pass over a stand-in renderer: what it writes, what it draws, and that it lays the layer back whatever.
//
// Run: node tools/swg/tests/skyDraw.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import * as TSL from 'three/tsl';
import { DayCycle } from '../../../src/world/daycycle.ts';
import { STAR_SYSTEMS, PAIR_TUNE, casterOf, kelvinToLinear, pairDirectionIn, secondOf, starsOf } from '../../../src/sky/stars.ts';
import { SKY_HOURS, SKY_HOUR_NAMES, isSkyHour, skyHourTime, sunSineAt, type SkyHour } from '../../../src/sky/skyHours.ts';
import { NIGHT_FLOOR, applyNightFloor, nightFloorWeight, type FloorLighting } from '../../../src/sky/air/nightFloor.ts';
import { DISC_TUNE, SKY_TUNE_RANGE, skyDialSet, tuneSky } from '../../../src/sky/skyDials.ts';
import { SKY_AT_LOAD, readSkyMode, resetSkyModeForTests, skyOurs, skyRowState } from '../../../src/sky/skyMode.ts';
import { covers, hazeBeyondIn, hazePixelIn, intoLayer, isSkyDepth, layerStackIn, rayDistance, referencePixelIn, seeKindOf, timesAlpha, viewZOfDepth, type SeeKind } from '../../../src/sky/air/airHazeMath.ts';
import { SEE_BLENDS, SEE_NAME, markSeeTarget, seeTextureOf } from '../../../src/sky/air/airSee.ts';
import { AIR, HAZE_REACH_M, type AirTables } from '../../../src/sky/air/airApi.ts';
import { GpuHazePass, hazeGraph, hazeTermsGraph, type HazeInputs } from '../../../src/sky/air/airHaze.ts';
import { airSkyMaterial } from '../../../src/sky/air/airSky.ts';
import { PIPELINE_NOW, markMotionTarget, motionMrt } from '../../../src/core/gpu/motion.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let passed = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const text = (p: string): string => readFileSync(join(root, p), 'utf8');
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- 1. the star table
{
  ok(starsOf('naboo') === starsOf('rori') && starsOf('naboo').suns.length === 1, 'Naboo and Rori stand under one star');
  ok(starsOf('corellia') === starsOf('talus'), 'and Corellia and Talus under Corell');
  ok(starsOf('tatooine').suns.length === 2 && secondOf('tatooine') !== null && secondOf('naboo') === null, 'Tatooine has its pair, every other world one star');
  const hoth = casterOf('adventure2');
  const c = [0, 0, 0];
  kelvinToLinear(hoth.kelvin, c);
  ok(starsOf('adventure2').system === 'hoth' && c[2] > c[0] * 1.15, `Hoth's sun is blue-white (${hoth.kelvin} K: r ${c[0].toFixed(3)}, b ${c[2].toFixed(3)})`);
  ok(starsOf('a world nobody has').system === 'plain', 'a world of no system takes the plain star');
  ok(Object.values(STAR_SYSTEMS).every((s) => s.suns[0].strength === 1 && s.suns.every((u) => u.radiusDeg > 0.1 && u.radiusDeg < 1 && u.kelvin > 2000)), 'every caster is 1 and every disc and colour is a star\'s');
  for (const k of [3000, 4600, 5778, 6500, 9500]) {
    kelvinToLinear(k, c);
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    ok(near(lum, 1, 1e-9) && c.every((x) => x >= 0), `${k} K: luminance one, no channel under nought`);
  }
  kelvinToLinear(6500, c);
  ok(c.every((x) => near(x, 1, 0.06)), `6,500 K is near white (${c.map((x) => x.toFixed(3)).join(', ')})`);
  kelvinToLinear(3000, c);
  ok(c[0] > c[1] && c[1] > c[2], '3,000 K is orange: red over green over blue');
}

// ---------------------------------------------------------------- 2. Tatooine's pair
{
  const o = { x: 0, y: 0, z: 0 };
  for (const [x, y, z] of [
    [0.3, 0.5, -0.81],
    [-0.9, 0.05, 0.43],
    [0.1, 0.92, 0.37],
  ]) {
    const l = Math.sqrt(x * x + y * y + z * z);
    pairDirectionIn(x / l, y / l, z / l, o);
    const len = Math.sqrt(o.x * o.x + o.y * o.y + o.z * o.z);
    const elC = Math.asin(y / l);
    const elS = Math.asin(o.y);
    const azC = Math.atan2(x, z);
    const azS = Math.atan2(o.x, o.z);
    ok(near(len, 1, 1e-12) && near(elC - elS, PAIR_TUNE.belowDeg * DEG, 1e-12) && near(azC, azS, 1e-12), `the second sun stands ${PAIR_TUNE.belowDeg}° under the caster on its own azimuth (caster at ${(elC / DEG).toFixed(1)}°)`);
  }
  // A whole day of the day's own path: when each crosses the horizon.
  const day = new DayCycle(0.6, 70 * DEG);
  day.swg = true;
  const N = 20000;
  let rise1 = -1;
  let rise2 = -1;
  let set1 = -1;
  let set2 = -1;
  let prev1 = 0;
  let prev2 = 0;
  for (let i = 0; i <= N; i++) {
    // From an hour before the day's dawn (06:00) round to it again.
    day.time = (0.2 + i / N) % 1;
    day.update(0, false);
    // The sun's own direction (by night the day's path hands it opposite the moon).
    pairDirectionIn(day.sunDir.x, day.sunDir.y, day.sunDir.z, o);
    const y1 = day.sunDir.y;
    const y2 = o.y;
    if (i > 0) {
      if (prev1 <= 0 && y1 > 0 && rise1 < 0) rise1 = i;
      if (prev2 <= 0 && y2 > 0 && rise2 < 0) rise2 = i;
      if (prev1 > 0 && y1 <= 0 && set1 < 0) set1 = i;
      if (prev2 > 0 && y2 <= 0 && set2 < 0) set2 = i;
    }
    prev1 = y1;
    prev2 = y2;
  }
  ok(rise1 >= 0 && rise2 > rise1, `over a whole day of the day's own path the second rises after the caster (${rise1} < ${rise2} of ${N})`);
  ok(set1 > 0 && set2 > 0 && set2 < set1, `and sets before it (${set2} < ${set1})`);
  const was = PAIR_TUNE.belowDeg;
  ok(tuneSky({ pair: { belowDeg: 4 } }).length === 0 && PAIR_TUNE.belowDeg === 4, 'the pair\'s dial moves it');
  pairDirectionIn(0, Math.sin(30 * DEG), Math.cos(30 * DEG), o);
  ok(near(Math.asin(o.y) / DEG, 26, 1e-9), 'and the second then stands 4° under');
  PAIR_TUNE.belowDeg = was;
}

// ---------------------------------------------------------------- 3. the hours
{
  ok(SKY_HOUR_NAMES.length === 4 && SKY_HOUR_NAMES.every(isSkyHour) && !isSkyHour('morning'), "the hours are dawn, noon, dusk and night");
  for (const swg of [true, false]) {
    const maxEl = 55 * DEG;
    const day = new DayCycle(1.1, maxEl);
    day.swg = swg;
    const el = (t: number): number => {
      day.time = t;
      day.update(0, false);
      return Math.asin(Math.max(-1, Math.min(1, day.sunDir.y))) / DEG;
    };
    let hi = -90;
    let lo = 90;
    for (let i = 0; i < 4000; i++) {
      const e = el(i / 4000);
      if (e > hi) hi = e;
      if (e < lo) lo = e;
    }
    const at = (h: SkyHour) => skyHourTime(h, swg, maxEl);
    const dawn = el(at('dawn'));
    const dawnAfter = el(at('dawn') + 1e-3);
    ok(near(dawn, SKY_HOURS.lowDeg, 0.02) && dawnAfter > dawn, `${swg ? "SWG's path" : 'the plain arc'}: dawn has the sun ${dawn.toFixed(3)}° up and rising`);
    const dusk = el(at('dusk'));
    const duskAfter = el(at('dusk') + 1e-3);
    ok(near(dusk, SKY_HOURS.lowDeg, 0.02) && duskAfter < dusk, `${swg ? "SWG's path" : 'the plain arc'}: dusk has it ${dusk.toFixed(3)}° up and setting`);
    ok(near(el(at('noon')), hi, 0.05), `${swg ? "SWG's path" : 'the plain arc'}: noon is the day's highest (${hi.toFixed(2)}°)`);
    ok(near(el(at('night')), lo, 0.05), `${swg ? "SWG's path" : 'the plain arc'}: night is its lowest (${lo.toFixed(2)}°)`);
    // The console's sun for a time just written, before the day's next update (the review: it read a frame behind).
    let worstSine = 0;
    for (let i = 0; i < 997; i++) {
      const t = i / 997;
      el(t);
      const d = Math.abs(sunSineAt(t, swg, maxEl) - day.sunDir.y);
      if (d > worstSine) worstSine = d;
    }
    ok(worstSine < 1e-12, `${swg ? "SWG's path" : 'the plain arc'}: the sun's height worked from a time is the day's own after its update, to ${worstSine.toExponential(1)}`);
    if (swg) {
      el(at('night'));
      ok(!day.isDay && day.lightDir.equals(day.moonDir), "on SWG's path the night lights the world by the moon at its highest");
    }
  }
  // A write of the time is a hold, as the console's own `time` is.
  const day = new DayCycle(0, 1);
  day.update(0.016, false);
  day.time = skyHourTime('noon', true, 1);
  day.update(0.016, false);
  ok(day.held === true, 'an hour written is held by the day');
  day.release();
  ok(day.held === false, 'and released, the shared clock has it again');
}

// ---------------------------------------------------------------- 4. the night floor
{
  ok(NIGHT_FLOOR.share === 1 && NIGHT_FLOOR.dayAt === 0.05 && NIGHT_FLOOR.nightAt === -0.1, "the floor starts at today's night in full, from about 3° up to 6° down");
  ok(nightFloorWeight(0.5) === 0 && nightFloorWeight(0.06) === 0 && nightFloorWeight(-0.11) === 1 && nightFloorWeight(-0.9) === 1, 'nought by day, whole by night');
  let last = -1;
  let rising = true;
  for (let y = 0.05; y >= -0.1; y -= 0.005) {
    const w = nightFloorWeight(y);
    if (w < last) rising = false;
    last = w;
  }
  ok(rising, 'and rising without a step through the twilight');
  const mk = (r: number, s: number): FloorLighting => ({ main: { r, g: r, b: r }, mainScale: s, ambient: { r, g: r, b: r }, ambientScale: s, bounce: { r: 0, g: 0, b: 0 }, bounceScale: 0, fill: { r: 1, g: 0.5, b: 0.2 }, fillScale: 0, fog: { r: 0, g: 0, b: 0 } });
  const lumOf = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  // The first part alone (no night's brightness to hold): today's colours of the hour by the sun's height.
  const dark = mk(0, 0);
  const swg = mk(1, 0.3);
  swg.fog = { r: 0.1, g: 0.11, b: 0.19 };
  const L = mk(1, 1e-5);
  applyNightFloor(L, swg, dark, { y: 0.4 });
  ok(L.mainScale === 1e-5 && L.fog.r === 0, 'by day the floor leaves the air\'s light and its fog alone');
  applyNightFloor(L, swg, dark, { y: -0.5 });
  ok(near(L.mainScale, 0.3, 1e-12) && near(L.ambientScale, 0.3, 1e-12), "by night a dark air's light is held at SWG's own");
  ok(L.fog.r === 0.1 && L.fog.g === 0.11 && L.fog.b === 0.19, "and the fog's colour the rain and the wet look read is held at SWG's own of the hour, not the air's black moonlit horizon (the review)");
  const bright = mk(1, 2);
  applyNightFloor(bright, swg, dark, { y: -0.5 });
  ok(bright.mainScale === 2, 'and a brighter air\'s light is left as it is');
  NIGHT_FLOOR.share = 0;
  const L2 = mk(1, 1e-5);
  applyNightFloor(L2, swg, mk(1, 0.8), { y: -0.5 });
  ok(L2.mainScale === 1e-5 && L2.fog.r === 0, 'with the share at nought the night is the air\'s physical one, its brightness too');
  NIGHT_FLOOR.share = 1;
  // The second part: today's night brightness held at every hour in the light's own colour (the review: dawn and dusk 8 times
  // darker than the night either side, since the first part lets go by the sun's height while the air is far under it).
  const night = mk(0.5, 0.4); // today's night at its middle: a grey of luminance 0.5 at scale 0.4, brightness 0.2
  night.fill = { r: 0.5, g: 0.5, b: 0.5 };
  night.fillScale = 0.4;
  const red = { r: 1 / 0.2126, g: 0, b: 0 };
  const dusk = mk(0, 0.01);
  dusk.main = { ...red };
  dusk.ambient = { r: 0.6, g: 0.5, b: 1.6 };
  dusk.ambientScale = 0.002;
  applyNightFloor(dusk, swg, night, { y: 0.06 });
  ok(near(dusk.mainScale * lumOf(dusk.main), 0.2, 1e-12) && dusk.main.r === red.r && dusk.main.g === 0, `just over the floor's day edge the reddened sun is held at today's night brightness (${(dusk.mainScale * lumOf(dusk.main)).toFixed(3)}) in its own red`);
  ok(near(dusk.ambientScale * lumOf(dusk.ambient), 0.2, 1e-12) && dusk.ambient.b === 1.6, 'and so is its sky, in its own colour');
  ok(dusk.fillScale === 0 && night.fillScale === 0.4, 'the fill (a second sun\'s alone) is never lifted by the night\'s brightness');
  const blackBounce = mk(0, 0);
  const nb = mk(0.5, 0.4);
  nb.bounce = { r: 0.2, g: 0.3, b: 0.4 };
  nb.bounceScale = 0.5;
  applyNightFloor(blackBounce, swg, nb, { y: 0.1 });
  ok(near(blackBounce.bounceScale * lumOf(blackBounce.bounce), 0.5 * lumOf(nb.bounce), 1e-12) && near(blackBounce.bounce.b / blackBounce.bounce.r, 2, 1e-12), "a light the air leaves black takes the night's colour at the night's brightness");
  const noon = mk(1, 1.2);
  applyNightFloor(noon, swg, night, { y: 0.9 });
  ok(noon.mainScale === 1.2 && noon.ambientScale === 1.2, 'by day the air, far brighter than the night, is left exactly as it is');
  // A sun setting through the whole band over an air that dims as the real one does: no hour darker than today's night.
  let worst = Infinity;
  let worstAt = 0;
  for (let y = 0.3; y >= -0.4; y -= 0.002) {
    const air = mk(1, y > 0 ? 3 * y * y : 1e-7);
    applyNightFloor(air, mk(1, 0.3), night, { y });
    const l = air.mainScale * lumOf(air.main);
    if (l < worst) {
      worst = l;
      worstAt = y;
    }
  }
  ok(worst >= 0.2 - 1e-12, `a sun setting through the band never leaves the main light under today's night brightness (least ${worst.toFixed(4)} at a sine of ${worstAt.toFixed(3)}, the night's 0.2)`);
  const src = text('src/world/world.ts');
  ok(/if \(GPU\.webgpu && AIR\.frame\.on\) applyNightFloor\(L, AIR\.swg, AIR\.swgNight, this\.day\.sunDir\);\r?\n    this\.sun\.color\.copy\(L\.main\);/.test(src), 'the world lays the floor under the air\'s lights before it turns them into lights, on WebGPU under the air alone');
}

// ---------------------------------------------------------------- 5. the dials
{
  const set = skyDialSet();
  ok(set.helper === 'sky' && set.groups.length >= 4, 'the sky\'s dials are the `sky` helper\'s');
  for (const g of set.groups) {
    for (const d of g.dials) {
      if (d.kind !== 'number') continue;
      const was = d.get();
      // The floor's night edge is kept under its day edge as well as in its range.
      const most = d.key === 'floor.nightAt' ? Math.min(d.max, NIGHT_FLOOR.dayAt - 0.01) : d.max;
      d.set(d.max + 100);
      const top = d.get();
      d.set(d.min - 100);
      const bottom = d.get();
      d.set(was);
      ok(near(top, most, 1e-12) && near(bottom, d.min, 1e-12) && near(d.get(), was, 1e-12), `the dial ${d.key} sets through tuneSky and is held to ${d.min} to ${most}`);
    }
  }
  ok(tuneSky({ floor: { dayAt: -0.2, nightAt: 0 } }).some((s) => s.startsWith('floor.nightAt')) && NIGHT_FLOOR.nightAt < NIGHT_FLOOR.dayAt, "the floor's night edge is kept under its day edge");
  tuneSky({ floor: { dayAt: 0.05, nightAt: -0.1 } });
  ok(tuneSky({ disc: { nope: 1 } }).length === 1 && tuneSky({ disc: { limb: 'a' } }).length === 1, 'a dial that is not there, or a value not a number, is said');
  ok(DISC_TUNE.limb === 0.6 && DISC_TUNE.edge === 0.15 && DISC_TUNE.gain === 1 && SKY_TUNE_RANGE.disc.gain[1] === 4, "the discs start at our sun's limb, a pixel's rim and the star's own light");
}

// ---------------------------------------------------------------- 6. the Sky row
{
  resetSkyModeForTests();
  ok(readSkyMode(false, 1) === false && SKY_AT_LOAD.how === 'webgl' && !skyOurs(), 'on WebGL the sky is SWG\'s whatever the row says');
  ok(skyRowState(false, 1)?.hide === true, 'and the row is left off the page');
  resetSkyModeForTests();
  ok(readSkyMode(true, 1) === true && skyOurs() && readSkyMode(true, 0) === true, 'on WebGPU the row at ours draws ours, read once (a later read changes nothing)');
  ok(skyRowState(true, 1) === null && /next start/.test(skyRowState(true, 0)?.note ?? ''), 'a change on the page waits for the next start, and the row says so');
  resetSkyModeForTests();
  ok(readSkyMode(true, 0) === false && SKY_AT_LOAD.asked === 0, "the row at SWG's draws today's sky");
  resetSkyModeForTests();
  readSkyMode(true, 1);
}

// ---------------------------------------------------------------- 7. the haze's arithmetic
{
  const mat = (o: Partial<THREE.Material> & Record<string, unknown>): THREE.Material => Object.assign(new THREE.MeshBasicMaterial(), o);
  const kinds: [THREE.Material, SeeKind][] = [
    [mat({}), 'solid'],
    [mat({ transparent: true }), 'over'],
    [mat({ transparent: true, premultipliedAlpha: true }), 'overPremultiplied'],
    [mat({ blending: THREE.AdditiveBlending }), 'add'],
    [mat({ blending: THREE.AdditiveBlending, premultipliedAlpha: true }), 'addPremultiplied'],
    [mat({ blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor }), 'over'],
    [mat({ blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }), 'addPremultiplied'],
    [mat({ blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor }), 'keep'],
    [mat({ blending: THREE.MultiplyBlending, premultipliedAlpha: true }), 'keep'],
    [mat({ blending: THREE.NoBlending, transparent: true }), 'solid'],
  ];
  for (const [m, k] of kinds) ok(seeKindOf(m as never) === k, `a ${m.transparent ? 'see-through' : 'solid'} material of blending ${m.blending}${m.premultipliedAlpha ? ' premultiplied' : ''} goes into the layer as ${k}`);
  // Random stacks: the layer's composite against every layer drawn and hazed the old way.
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 4294967296;
  };
  const into: SeeKind[] = ['over', 'overPremultiplied', 'add', 'addPremultiplied'];
  let worst = 0;
  for (let n = 0; n < 2000; n++) {
    const solid = [rnd() * 3, rnd() * 3, rnd() * 3];
    const st = rnd();
    const sl = [rnd(), rnd(), rnd()];
    const hazed = rnd() > 0.2;
    const layers = Array.from({ length: Math.floor(rnd() * 5) }, () => ({ kind: into[Math.floor(rnd() * into.length)], rgb: [rnd() * 4, rnd() * 4, rnd() * 4], a: rnd(), t: rnd(), l: [rnd(), rnd(), rnd()] }));
    const c = [...solid];
    const s = [0, 0, 0, 1];
    layerStackIn(layers, c, s);
    const got = [0, 0, 0];
    hazePixelIn(c, s, st, sl, hazed, got);
    const want = [0, 0, 0];
    referencePixelIn(solid, st, sl, hazed, layers, want);
    for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(got[i] - want[i]));
  }
  ok(worst < 1e-12, `2,000 stacks of up to four see-through layers over a solid: the layer's composite is every layer drawn and hazed at its own distance (worst ${worst.toExponential(1)})`);
  // A smoke before a far ridge: hazed at its own distance, never at the ridge's.
  {
    // A white smoke of 90% a few metres off (2% of its light lost, a little air added) before a ridge 90% hazed.
    const ridge = [0.3, 0.25, 0.2];
    const smoke = { kind: 'over' as SeeKind, rgb: [0.9, 0.9, 0.9], a: 0.9, t: 0.98, l: [0.01, 0.01, 0.012] };
    const ridgeT = 0.1;
    const ridgeL = [0.3, 0.33, 0.36];
    const c = [...ridge];
    const s = [0, 0, 0, 1];
    layerStackIn([smoke], c, s);
    const got = [0, 0, 0];
    hazePixelIn(c, s, ridgeT, ridgeL, true, got);
    const own = smoke.rgb[0] * smoke.t + smoke.l[0];
    // The old way's fault: the picture as drawn (smoke over ridge) hazed as a whole at the ridge's distance.
    const asRidge = (smoke.rgb[0] * smoke.a + ridge[0] * (1 - smoke.a)) * ridgeT + ridgeL[0];
    ok(near(got[0], own * smoke.a + (ridge[0] * ridgeT + ridgeL[0]) * (1 - smoke.a), 1e-12) && got[0] - asRidge > 0.3, `a white smoke of 90% before a ridge 90% hazed keeps its own haze (${got[0].toFixed(3)}, where the picture hazed at the ridge's distance reads ${asRidge.toFixed(3)})`);
  }
  // A room's solid pixel from inside: the layer laid back, no haze.
  {
    const got = [0, 0, 0];
    hazePixelIn([0.2, 0.2, 0.2], [0.1, 0, 0, -0.5], 0.5, [1, 1, 1], false, got);
    ok(got[0] === 0.30000000000000004 || near(got[0], 0.3, 1e-15), 'a pixel left unhazed takes the colour and the layer alone');
  }
  // Distances against three's own camera, reversed and not.
  for (const reversed of [true, false]) {
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
    (cam as Any).coordinateSystem = THREE.WebGPUCoordinateSystem;
    (cam as Any)._reversedDepth = reversed;
    cam.updateProjectionMatrix();
    let worstZ = 0;
    let worstD = 0;
    const tx = Math.tan((cam.fov * DEG) / 2) * cam.aspect;
    const ty = Math.tan((cam.fov * DEG) / 2);
    for (const z of [0.3, 2, 40, 900, 8000]) {
      for (const [nx, ny] of [
        [0, 0],
        [0.7, -0.4],
        [-0.95, 0.9],
      ]) {
        const p = new THREE.Vector3(nx * tx * z, ny * ty * z, -z);
        const c = p.clone().applyMatrix4(cam.projectionMatrix);
        const zz = viewZOfDepth(c.z, cam.near, cam.far, reversed);
        worstZ = Math.max(worstZ, Math.abs(zz - z) / z);
        worstD = Math.max(worstD, Math.abs(rayDistance(z, c.x, c.y, tx, ty) - p.length()) / p.length());
      }
    }
    ok(worstZ < 1e-9 && worstD < 1e-9, `${reversed ? 'reversed' : 'ordinary'} depth: a texel's view depth and its ray's length are three's camera's own (worst ${worstZ.toExponential(1)}, ${worstD.toExponential(1)})`);
    ok(isSkyDepth(reversed ? 0 : 1, reversed) && !isSkyDepth(0.5, reversed), `${reversed ? 'reversed' : 'ordinary'} depth: the clear is the sky`);
  }
  // Past the reach.
  {
    const o = [0, 0, 0, 0];
    const l = [0.2, 0.25, 0.3];
    const sky = [0.6, 0.7, 0.9];
    hazeBeyondIn(HAZE_REACH_M, HAZE_REACH_M, l, 0.3, sky, o);
    ok(o[3] === 0.3 && o[0] === 0.2, 'at the reach the haze is the volume\'s own');
    hazeBeyondIn(HAZE_REACH_M * 1.0001, HAZE_REACH_M, l, 0.3, sky, o);
    ok(near(o[3], 0.3, 1e-4) && near(o[0], 0.2, 1e-4), 'and just past it no step');
    hazeBeyondIn(HAZE_REACH_M * 60, HAZE_REACH_M, l, 0.3, sky, o);
    ok(o[3] < 1e-30 && near(o[2], 0.9, 1e-12), 'and far past it the light behind is lost and the air is the sky itself');
  }
}

// ---------------------------------------------------------------- 8. the layer's blends
{
  /** One output blended as a GPU blends it: src · srcFactor + dst · dstFactor, colour and alpha apart. */
  const factor = (f: number, src: number[], dst: number[]): number => (f === THREE.ZeroFactor ? 0 : f === THREE.OneFactor ? 1 : f === THREE.OneMinusSrcAlphaFactor ? 1 - src[3] : f === THREE.SrcAlphaFactor ? src[3] : NaN);
  const blend = (b: Any, src: number[], dst: number[]): number[] => {
    if (b.blending === THREE.NoBlending) return [...src];
    const fs = factor(b.blendSrc, src, dst);
    const fd = factor(b.blendDst, src, dst);
    const fsa = factor(b.blendSrcAlpha, src, dst);
    const fda = factor(b.blendDstAlpha, src, dst);
    return [src[0] * fs + dst[0] * fd, src[1] * fs + dst[1] * fd, src[2] * fs + dst[2] * fd, src[3] * fsa + dst[3] * fda];
  };
  let worst = 0;
  let seed = 99;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 4294967296;
  };
  const into: SeeKind[] = ['over', 'overPremultiplied', 'add', 'addPremultiplied', 'keep'];
  for (let n = 0; n < 500; n++) {
    const layers = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => ({ kind: into[Math.floor(rnd() * 4)], rgb: [rnd() * 3, rnd() * 3, rnd() * 3], a: rnd(), t: 1, l: [0, 0, 0] }));
    const sign = rnd() > 0.5 ? 1 : -1;
    const ref = [0, 0, 0, sign];
    layerStackIn(layers, [0, 0, 0], ref);
    // The layer as the GPU leaves it: the solid's write, then each kind's output through its blend. A straight kind's output is
    // its colour times its alpha (`airSee.ts` multiplies it); a premultiplied one's colour three has already multiplied by it.
    let dst = blend(SEE_BLENDS.solid, [0, 0, 0, sign], [0, 0, 0, 1]);
    for (const ly of layers) {
      const asItLeaves = timesAlpha(ly.kind) ? 1 : ly.a;
      const k = (timesAlpha(ly.kind) ? ly.a : 1) * asItLeaves;
      const out = intoLayer(ly.kind) ? [ly.rgb[0] * k, ly.rgb[1] * k, ly.rgb[2] * k, ly.a] : [0, 0, 0, 0];
      dst = blend(SEE_BLENDS[ly.kind], out, dst);
    }
    for (let i = 0; i < 4; i++) worst = Math.max(worst, Math.abs(dst[i] - ref[i]));
  }
  ok(worst < 1e-12, `500 stacks blended into the layer by its own blends give the rule's layer, its alpha's sign kept (worst ${worst.toExponential(1)})`);
  ok(covers('over') && covers('overPremultiplied') && !covers('add') && !intoLayer('keep') && !intoLayer('solid'), 'only an over-blend covers; neither a solid nor another blend writes the layer');
  const node = motionMrt() as Any;
  ok(node.has(SEE_NAME) && node.has('fx.scene') && node.has('motion'), "the motion's multi-output node carries the colour's entry and the layer beside the motion");
  for (const k of ['solid', 'over', 'add', 'keep'] as SeeKind[]) {
    PIPELINE_NOW.see = k;
    ok(node.getBlendMode(SEE_NAME) === SEE_BLENDS[k], `a pipeline of a ${k} draw blends the layer by its kind's rule`);
  }
  PIPELINE_NOW.see = 'solid';
  ok(node.getClearColor(SEE_NAME)?.a === 1 && node.getClearColor(SEE_NAME)?.r === 0, 'the layer is cleared to (0, 0, 0, 1): nothing in front, all of the solid let through');
  const see = text('src/sky/air/airSee.ts');
  ok(see.includes('return vec4(timesAlpha(k) ? o.rgb.mul(o.a) : o.rgb, o.a);') && see.includes("if (k === 'solid') return vec4(0, 0, 0, roomSign());") && see.includes('return vec4(0, 0, 0, vec4(output).a);'), "the layer's outputs are the rule's: a straight kind's light times its alpha, a solid's sign, nought into the colour with the alpha");
  ok(see.includes("f.scene?.userData?.swgRoomsPass === true ? -1 : 1") && text('src/world/passScenes.ts').includes('this.rooms.userData.swgRoomsPass = true;'), "a room's solid pixels are marked by the rooms' own scene");
}

// ---------------------------------------------------------------- 9. the graphs
/** A stand-in of the air's tables: each reader a node of its own over uniforms, as the air's maker's readers are. */
function standInTables(): AirTables {
  const { uniform, vec3, vec4, float } = TSL as Any;
  const nodes = { sunDir: uniform(new THREE.Vector3(0, 1, 0)), sun2Dir: uniform(new THREE.Vector3(0, 1, 0)), moonDir: uniform(new THREE.Vector3(0, -1, 0)), sunTop: uniform(new THREE.Color(2, 2, 2)), sun2Top: uniform(new THREE.Color(0, 0, 0)), moonTop: uniform(new THREE.Color(0, 0, 0)), sunRadius: uniform(0.0047), heightKm: uniform(0.01), gain: uniform(new THREE.Vector3(1, 1, 1)), overcast: uniform(0) };
  const t = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  return {
    transmittance: t,
    multiScatter: t,
    skyView: t,
    haze: t,
    skyRadiance: (dir: Any) => vec3(dir.y.mul(0.1), 0.2, 0.3),
    transmittanceToSpace: (dir: Any) => vec3(dir.y.max(0)),
    hazeAt: (ndc: Any, d: Any) => vec4(ndc.x.mul(0), d.mul(1e-5), 0.1, float(1).sub(d.mul(1e-5))),
    nodes,
    frame: () => {},
    ready: true,
    report: () => ({ standIn: true }),
  } as unknown as AirTables;
}
function sceneTarget(w: number, h: number, see: boolean): THREE.RenderTarget {
  const depth = new THREE.DepthTexture(w, h, THREE.FloatType);
  const t = new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, samples: 0, depthTexture: depth, count: see ? 3 : 2 });
  t.texture.name = 'fx.scene';
  markMotionTarget(t);
  if (see) markSeeTarget(t);
  return t;
}
{
  const target = sceneTarget(64, 36, true);
  ok(target.textures[2].name === SEE_NAME && seeTextureOf(target.texture) === target.textures[2] && seeTextureOf(sceneTarget(8, 8, false).texture) === null, 'a scene target made with the layer names its third texture for it; one without has none');
  const u: HazeInputs = { input: { value: null }, depth: target.depthTexture as THREE.Texture, see: target.textures[2], reversed: true, p0: new THREE.Vector4(0.05, 9000.5, 0.5, 0.5), p1: new THREE.Vector4(0.5, 0.5, 1.5, 1.5), turn: new THREE.Matrix3() };
  const plain = hazeGraph(u, false);
  ok(plain.material.name === 'fx.gpu.haze.plain' && plain.textures === 3 && plain.parts.uniforms.p0.value === u.p0 && plain.parts.textures.see.value === u.see && plain.parts.textures.depth.value === u.depth, 'the plain composite builds over the pass\'s own records');
  const kept = AIR.tables;
  AIR.tables = standInTables();
  try {
    const air = hazeGraph(u, true);
    ok(air.material.name === 'fx.gpu.haze' && air.textures === 3 && air.parts.uniforms.turn.value === u.turn && air.parts.uniforms.p1.value === u.p1 && (air.parts.textures.input as Any).isLiveTexture === true, "the air's haze builds over the pass's records and the air's readers, three pictures of its own");
    ok(air.material.depthTest === false && air.material.fog === false && air.material.toneMapped === false, 'and is a chain graph: no depth, no fog, nothing of three\'s output');
    // The half mode (the Low tier's): the terms at half size into a picture of two outputs, and the lay-on reading them.
    const tt = new THREE.RenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0, count: 2 });
    const terms = { target: tt, size: new THREE.Vector4(1.5, 1.5, 1.5, 1.5) };
    const tg = hazeTermsGraph(u, terms)!;
    ok(tg.material.name === 'fx.gpu.haze.terms' && (tg.material as Any).swgRawOut === true && (tg.material.fragmentNode as Any)?.isOutputStructNode === true && tg.parts.uniforms.termsSize.value === terms.size, 'the half mode\'s terms write two outputs (the air\'s terms, the nearest solid\'s distance), carried through no output of three\'s');
    const hg = hazeGraph(u, true, terms);
    ok(hg.material.name === 'fx.gpu.haze.half' && hg.textures === 5 && hg.parts.textures.terms.value === tt.textures[0] && hg.parts.textures.termsDistance.value === tt.textures[1], 'and the lay-on reads both of the terms\' pictures beside the picture, the depth and the layer');
    const m = airSkyMaterial('tatooine', new THREE.Color(0.5, 0.5, 0.5), new THREE.Color(0.3, 0.4, 0.6)) as Any;
    ok(m.name === 'gpu: our sky' && m.fog === false && m.colorNode !== null && m.colorNode.isNode === true, 'our sky builds over the air\'s readers');
  } finally {
    AIR.tables = kept;
  }
  const fallback = airSkyMaterial('naboo', new THREE.Color(0.5, 0.5, 0.5), new THREE.Color(0.3, 0.4, 0.6)) as Any;
  ok(fallback.colorNode?.isNode === true, "with no air's tables our sky is today's stand-in");
  for (const f of ['src/sky/air/airHaze.ts', 'src/sky/air/airSky.ts', 'src/sky/air/airSee.ts']) {
    const src = text(f);
    ok(!/positionWorld|cameraPosition|modelWorldMatrix|cameraWorldMatrix/.test(src), `${f} reads no place measured from the world's middle`);
  }
  const haze = text('src/sky/air/airHaze.ts');
  const body = haze.slice(haze.indexOf('m.fragmentNode = Fn(() => {'), haze.indexOf('HAZE_STATS.built++;'));
  const ifAt = body.indexOf('If(hazed');
  const reads = ['input.sample(', 'see.load(', 'depth.load(', 'airTerms(', 'tl.load(', 'td.load('];
  ok(ifAt > 0 && reads.every((r) => body.indexOf(r) > 0 && body.indexOf(r) < ifAt), "every picture the haze reads is read before the haze branches (three writes a `select` out as an `if`)");
  const terms = haze.slice(haze.indexOf('function airTerms('), haze.indexOf('export function hazeGraph('));
  ok(terms.includes('tables.hazeAt(') && terms.includes('tables.skyRadiance(') && !/\bIf\(/.test(terms), "the air's two tables are read where the terms are worked out, which branches on nothing");
  ok(haze.slice(haze.indexOf('export function hazeTermsGraph(')).indexOf('airTerms(') > 0, "the half mode's terms are the full mode's own arithmetic (`airTerms`)");
  const sky = text('src/sky/air/airSky.ts');
  const skyBody = sky.slice(sky.indexOf('m.colorNode = Fn(() => {'));
  ok(skyBody.indexOf('tables.skyRadiance(d)') < skyBody.indexOf('disc(') && skyBody.indexOf('tables.transmittanceToSpace(d)') < skyBody.indexOf('disc('), "our sky reads the air's tables at the top of its colour");
  ok(!/smoothstep\(dayAt, nightAt/.test(sky), "the night floor's step has its edges in rising order, as WGSL asks");
}

// ---------------------------------------------------------------- 10. the haze pass over a stand-in renderer
{
  const target = sceneTarget(64, 36, true);
  const drawn: string[] = [];
  const r: Any = {
    reversedDepthBuffer: true,
    setRenderTarget(t: Any) {
      drawn.push(`target:${t === null ? 'canvas' : t.texture.name}`);
    },
    render(mesh: Any) {
      drawn.push(`draw:${mesh.material.name}`);
    },
  };
  const pass = new GpuHazePass(r, target);
  const ctx: Any = { renderer: r, near: 0.05, far: 9000, inside: false, space: false, tanHalfFov: new THREE.Vector2(0.9, 0.5), camera: new THREE.PerspectiveCamera() };
  ctx.camera.rotation.set(0.3, 1.1, 0);
  ctx.camera.updateMatrixWorld();
  ok(pass.enabled(ctx) && pass.reason(ctx) === null, 'the pass draws over a scene target with the layer');
  pass.prepare(ctx);
  const inp = { width: 64, height: 36, texture: new THREE.Texture() } as Any;
  const out = { texture: { name: 'fx.b' } } as Any;
  ok(pass.render(ctx, inp, out) === true && drawn.join() === 'target:fx.b,draw:fx.gpu.haze.plain', "with no air's tables it lays the layer back alone, into the next buffer");
  const items = pass.materials();
  ok(items.length === 1 && items[0].where === 'target', 'and asks the warm-up for the plain graph alone');
  const kept = AIR.tables;
  AIR.tables = standInTables();
  AIR.frame.on = true;
  try {
    const items2 = pass.materials();
    ok(items2.length === 4 && items2[1].material.name === 'fx.gpu.haze', "once the air's tables exist the warm-up's ask builds the air's graphs too, behind its screen");
    drawn.length = 0;
    pass.prepare(ctx);
    pass.render(ctx, inp, out);
    ok(drawn.join() === 'target:fx.b,draw:fx.gpu.haze', 'and the frame draws it');
    const m = new THREE.Matrix3().setFromMatrix4(ctx.camera.matrixWorld);
    const p = (pass as Any).inputs as HazeInputs;
    ok(p.p0.x === 0.05 && p.p0.y === 9000 && p.p0.z === 0 && p.p0.w === 1 && p.p1.x === 0.9 && p.p1.y === 0.5 && p.p1.z === 64 && p.p1.w === 36 && p.turn.equals(m) && p.input.value === inp.texture, "it writes the frame's near, far, the building and the air's word, the view's extents, the scene's size and the camera's turn");
    drawn.length = 0;
    ctx.space = true;
    pass.prepare(ctx);
    pass.render(ctx, inp, out);
    ok(drawn.join() === 'target:fx.b,draw:fx.gpu.haze.plain', 'in space no air: the layer laid back alone');
    ctx.space = false;
    // The half mode (the Graphics page's Haze detail at Half, the Low tier's): the terms at half the scene's size first, into
    // their own picture, then laid on into the next buffer; a pixel while the full mode draws.
    const items3 = pass.materials();
    ok(items3.length === 4 && items3[2].material.name === 'fx.gpu.haze.terms' && items3[2].into === (pass as Any).terms.target && items3[3].material.name === 'fx.gpu.haze.half', 'both modes are warmed whichever draws: the terms against their own picture, the lay-on against a chain buffer');
    pass.setSize(64, 36, { hazeResolution: 0.5 } as Any);
    drawn.length = 0;
    pass.prepare(ctx);
    pass.render(ctx, inp, out);
    const tt = (pass as Any).terms.target as THREE.RenderTarget;
    ok(drawn.join() === 'target:fx.gpu.haze.terms,draw:fx.gpu.haze.terms,target:fx.b,draw:fx.gpu.haze.half' && tt.width === 32 && tt.height === 18, `at Half the terms are drawn at half the scene's size (${tt.width} by ${tt.height}) and laid on`);
    pass.setSize(64, 36, { hazeResolution: 1 } as Any);
    ok(tt.width === 1 && tt.height === 1, 'at Full the terms\' picture stands at a pixel');
  } finally {
    AIR.tables = kept;
    AIR.frame.on = false;
  }
  const none = new GpuHazePass(r, sceneTarget(8, 8, false));
  ok(!none.enabled(ctx) && /no see-through layer/.test(none.reason(ctx) ?? ''), 'over a scene target with no layer the pass draws nothing and says why');
  pass.dispose();
  none.dispose();
}

console.log(`\nskyDraw: ${passed} checks passed`);
