// Skies in motion in the game (the GPU port's pass 2, wave 5, maker S): `src/sky/system/skyMotion.ts`, `worldDays.ts` and the
// day that follows them (`DayCycle`, the shared clock), under node with the viewer's own drafts (`drafts.js`) as the applied
// systems and stand-in skies (made-up sizes, no converted file):
//   - which system a world follows (a star system by its grounds, a copied sky by its world, a first-round sky, none);
//   - a world's own day: its length, its hour on the shared clock, the server's sum and the story's hour one hour; with no
//     server the wall clock; an admin's anchor on the game's day never moving it;
//   - one sky time: the sky's `T` the real clock's to the bit when taken outright, and unbroken across 06:00, the day's turn and
//     a hand's write of the time, so a moon never jumps;
//   - Yavin 4 (locked to Yavin Prime): Prime held still all day within its wobble, a total eclipse once a day with the sun up,
//     Prime full by night, the night light its red giantshine;
//   - Tatooine's pair: the second sun rises after and sets before the caster, the gap between the two discs' edges the
//     system's separation as the game draws the discs, never overlapping, at every moment;
//   - Naboo and Rori applied together: at one shared moment each sees the other where the other's sky puts it;
//   - a world not applied: the day bit for bit as at the base, the hours of `__debug.sky` and the dials.
//
// Run: node tools/swg/tests/skyMotion.test.ts
import assert from 'node:assert/strict';
import { draftSystem } from '../../../src/sky/system/drafts.js';
import { draftV1For } from '../../../src/sky/system/drafts.js';
import { EPOCH_MS, defaultDayHours, realDays } from '../../../src/sky/system/system.js';
import { MOTION_TUNE, SKY_MOTION, skyMotionFor, skyPlacesOf, appliedSystemOf, worldDayOf, worldHourAt, worldDaysOf, type SkyMotion } from '../../../src/sky/system/skyMotion.ts';
import { motionHourTime, tuneMotion, motionDialGroup, serverDayWord } from '../../../src/sky/system/motionDials.ts';
import { SKY_DIAL_GROUPS, DISC_TUNE } from '../../../src/sky/skyDials.ts';
import { sharedClock } from '../../../src/world/sharedClock.ts';
import { DayCycle } from '../../../src/world/daycycle.ts';
import { hourOfDay } from '../../../src/world/dayPhase.ts';
import { WorldClock, WorldDays, ownDayFraction } from '../../../server/clock.mjs';
import { SHADE_TUNE } from '../../../src/sky/system/skyShade.ts';
import { storyWorlds } from '../../../server/storyWorlds.mjs';

let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const DEG = Math.PI / 180;
const upDeg = (y: number): number => Math.asin(y > 1 ? 1 : y < -1 ? -1 : y) / DEG;
const angle = (a: ArrayLike<number>, i: number, b: ArrayLike<number>, j: number): number => {
  const c = a[i] * b[j] + a[i + 1] * b[j + 1] + a[i + 2] * b[j + 2];
  return Math.acos(c > 1 ? 1 : c < -1 ? -1 : c) / DEG;
};

// Stand-in skies: SWG's slots and a celestial at sizes of our own (no converted file is read).
const SKY = {
  sun: { size: 0.6 },
  supplementalSun: { size: 0.55 },
  moon: { size: 0.5 },
  supplementalMoon: { size: 0.25 },
  celestials: [{ size: 0.45, image: { file: 'sky/cels_ice_moon.png' } }, { size: 0.12, image: { file: 'sky/cels_moon_earthy01.png' } }, { size: 1, image: { file: 'sky/cels_naboo.png' } }, { size: 0.15, image: { file: 'sky/cels_moon_mercury.png' } }],
};
const systems: Record<string, unknown> = { yavin: draftSystem('yavin'), tatoo: draftSystem('tatoo'), naboo: draftSystem('naboo') };

// ---------------------------------------------------------------- which system, and the places
{
  ok(appliedSystemOf(systems, 'yavin4')?.id === 'yavin' && appliedSystemOf(systems, 'yavin4')?.rule === 'system', 'Yavin 4 follows the Yavin system it is a ground of');
  ok(appliedSystemOf(systems, 'rori')?.id === 'naboo' && appliedSystemOf(systems, 'naboo')?.id === 'naboo', 'Naboo and Rori both follow the one Naboo system (one system per star)');
  ok(appliedSystemOf(systems, 'otoh_gunga')?.id === 'naboo', "a copied sky (Otoh Gunga's) follows its world's system");
  ok(appliedSystemOf(systems, 'corellia') === null && appliedSystemOf(null, 'yavin4') === null && appliedSystemOf({}, 'yavin4') === null, 'a world no applied system holds follows none (SWG\'s sky, the game\'s day)');
  const v1 = draftV1For('dathomir');
  ok(appliedSystemOf({ ...systems, 'v1:dathomir': v1 }, 'dathomir')?.rule === 'one-world', "a first-round one-world sky applied for a world (`v1:<world>`) is followed where no star system holds it");
  ok(appliedSystemOf({ yavin: { ...(draftSystem('yavin') as object), version: 9 } }, 'yavin4') === null, 'a system of a later version is never modelled here');
  const places = skyPlacesOf('yavin4', SKY);
  ok(places.get('yavin4:moon')?.slot === 'moon' && places.get('yavin4:celestial:cels_ice_moon')?.index === 0 && places.get('yavin4:celestial:yavin_prime')?.slot === 'extra', "the places of a sky: SWG's slots, its celestials by picture, the owner's extra places (Yavin Prime, 30 degrees)");
  ok(Math.abs((places.get('yavin4:moon')?.sizeDeg ?? 0) - (2 * Math.atan(0.5 / 3)) / DEG) < 1e-12 && places.get('yavin4:celestial:yavin_prime')?.sizeDeg === 30, "a slot's size is its square's angle, 2 atan(size / 3)");
  const two = skyPlacesOf('rori', { celestials: [{ size: 0.2, image: { file: 'sky/moon_single.png' } }, { size: 0.3, image: { file: 'sky/moon_single.png' } }] });
  ok(two.has('rori:celestial:moon_single') && two.has('rori:celestial:moon_single#2'), 'a second celestial of one picture is `#2`, as the viewer names it');
}

// ---------------------------------------------------------------- a world's own day: the clock, the server, the story
const WALL = Date.UTC(2026, 10, 23, 18, 7, 13);
let wall = WALL;
sharedClock.wall = () => wall;
sharedClock.none();
const yavin = skyMotionFor(systems, 'yavin4', 'yavin4', SKY)!;
const tat = skyMotionFor(systems, 'tatooine', 'tatooine', SKY)!;
const naboo = skyMotionFor(systems, 'naboo', 'naboo', SKY)!;
const rori = skyMotionFor(systems, 'rori', 'rori', SKY)!;
ok(!!yavin && !!tat && !!naboo && !!rori, 'each applied world has its motion');
{
  const d = worldDayOf(systems.yavin as Record<string, unknown>, 'yavin4')!;
  ok(d.lengthSeconds === 4 * 3600 && yavin.lengthSeconds === d.lengthSeconds, `Yavin 4's own day is its lore day over six, held to 2 to 6 hours: ${d.lengthSeconds / 3600} h`);
  ok(tat.lengthSeconds === defaultDayHours(23) * 3600 && naboo.lengthSeconds === defaultDayHours(26) * 3600, `Tatooine's and Naboo's own days: ${(tat.lengthSeconds / 3600).toFixed(3)} h, ${(naboo.lengthSeconds / 3600).toFixed(3)} h`);
  const day = new DayCycle(0, 1);
  day.follow(yavin);
  day.update(0, false);
  const T = yavin.T;
  ok(Math.abs(T - realDays(wall)) < 1e-9, `with no server the applied world's sky stands on the wall clock: T ${T.toFixed(9)} against the real days ${realDays(wall).toFixed(9)}`);
  ok(Math.abs(day.time * 24 - worldHourAt(yavin, wall)) < 1e-9 && Math.abs(yavin.hour - day.time * 24) < 1e-6, `its hour is the system's own on that clock: ${(day.time * 24).toFixed(4)} (worldHourAt ${worldHourAt(yavin, wall).toFixed(4)}, the system's ${yavin.hour.toFixed(4)})`);
  ok(day.lengthNow === yavin.lengthSeconds, "the day's length now is the system's");
  // A server: its clock 7 minutes ahead of this machine; the hail opens sharing and the day takes the world's own hour on it.
  const serverAhead = 7 * 60_000 + 412;
  const server = new WorldClock({ now: () => wall + serverAhead, dayMs: 7716000 });
  sharedClock.hail(server.now(), server.dayMs);
  day.follow(null);
  day.follow(yavin);
  day.update(0, false);
  const table = new WorldDays(worldDaysOf(systems));
  const own = table.of('yavin4')!;
  ok(!!own && own.lengthSeconds === yavin.lengthSeconds && own.phase === yavin.phase, "the server's table of the worlds' own days is the browser's (the same file read by the same code)");
  const serverFrac = ownDayFraction(server.now(), own);
  ok(Math.abs(serverFrac - day.time) < 1e-12, `the server's time of day of Yavin 4 and this browser's are one: ${serverFrac.toFixed(9)} against ${day.time.toFixed(9)}`);
  const sw = storyWorlds({ clock: server, days: () => table });
  ok(sw.hourOf('yavin4') === hourOfDay(day.time), `the story's hour on the server is the hour this sky is drawn at: ${sw.hourOf('yavin4')} against ${hourOfDay(day.time)}`);
  const swOld = storyWorlds({ clock: server });
  ok(swOld.hourOf('tatooine') === storyWorlds({ clock: server, days: () => new WorldDays({}) }).hourOf('tatooine'), "a world no system holds keeps the game's own hour on the server");
  // The admin's anchor on the game's day never moves a system's.
  const before = day.time;
  sharedClock.dayWord(3_600_000, server.now() - 1234, 0.37);
  wall += 1000 / 60;
  day.update(1 / 60, false);
  const step = (1 / 60) / yavin.lengthSeconds;
  ok(Math.abs(day.time - before - step) < 1e-9, `an admin's new day length and anchor leave a system's day where it was (moved ${(day.time - before).toExponential(3)}, one frame's step ${step.toExponential(3)})`);
  const word = serverDayWord(yavin, 'yavin4', { yavin4: { lengthSeconds: own.lengthSeconds, phase: own.phase } }, server.now(), day.time);
  ok(!!word && word.sameDay === true && Math.abs(Number(word.serverHour) - day.time * 24) < 1e-3, `the console holds this browser's day to the server's hail (${JSON.stringify(word)})`);
  sharedClock.none();
  day.follow(null);
}

// ---------------------------------------------------------------- one sky time
{
  wall = WALL;
  sharedClock.none();
  const day = new DayCycle(0, 1);
  day.follow(tat);
  day.update(0, false);
  const dt = 1 / 30;
  let lastT = tat.T;
  let worst = 0;
  let crossedSix = false;
  let crossedTurn = false;
  let lastHour = day.time * 24;
  const moon = tat.items.findIndex((it) => it.place === 'tatooine:moon');
  const prevDir = new Float64Array(3);
  let worstMoon = 0;
  for (let k = 0; k < 3; k++) prevDir[k] = tat.dir[3 * moon + k];
  // A whole day of Tatooine's and a little more, a frame a thirtieth of a second (fast-forwarded by the wall in big steps).
  const frames = Math.ceil((tat.lengthSeconds * 1.1) / (dt * 40));
  for (let f = 0; f < frames; f++) {
    wall += dt * 40 * 1000;
    day.update(dt * 40, false);
    const dT = tat.T - lastT;
    worst = Math.max(worst, Math.abs(dT - (dt * 40) / 86400));
    const h = day.time * 24;
    if (lastHour < 6 && h >= 6) crossedSix = true;
    if (h < lastHour) crossedTurn = true;
    lastHour = h;
    lastT = tat.T;
    worstMoon = Math.max(worstMoon, angle(prevDir, 0, tat.dir, 3 * moon));
    for (let k = 0; k < 3; k++) prevDir[k] = tat.dir[3 * moon + k];
  }
  ok(crossedSix && crossedTurn, "the run crossed the world's 06:00 and its day's turn");
  ok(worst < 1e-9, `the sky's time walked with the clock every frame, never a jump (worst off a frame's step ${worst.toExponential(2)} days)`);
  ok(worstMoon < 0.5, `so Tatooine's moon moved smoothly with the sky's turn, never jumping (most a step of ${(dt * 40).toFixed(2)} s: ${worstMoon.toFixed(3)} degrees)`);
  // A hand's write of the time (the console's): the count follows it the shorter way, then walks on from there.
  const T0 = tat.T;
  day.time = (day.time + 0.3) % 1;
  day.update(dt, false);
  const moved = (tat.T - T0) * 86400;
  ok(day.held && Math.abs(moved - (0.3 * tat.lengthSeconds + dt)) < 1e-3, `a written hour moves the sky's time the shorter way round, by that share of the world's own day (${moved.toFixed(2)} s for 0.3 of ${tat.lengthSeconds.toFixed(0)} s)`);
  const T1 = tat.T;
  day.update(dt, false);
  ok(Math.abs((tat.T - T1) * 86400 - dt) < 1e-6, 'and held, it walks on at the real rate from there');
  day.time = (day.time + 0.9) % 1;
  const T2 = tat.T;
  day.update(dt, false);
  ok(Math.abs((tat.T - T2) * 86400 + 0.1 * tat.lengthSeconds - dt) < 1e-3, 'a write of nine tenths of a day ahead is a tenth back: never a whole day jumped');
  day.release();
  wall += 1;
  day.update(dt, false);
  ok(!day.held, 'handed back, the day follows the clock again (it eases there as any day does)');
  // Held by hand on one world, then a travel to another applied world: the count takes the new day's whole days, so the new
  // world's moons stand at the real clock's day, the held hour kept within it.
  day.time = (day.time + 0.45) % 1;
  day.update(dt, false);
  for (let i = 0; i < 200; i++) {
    wall += 50_000;
    day.update(dt, false);
  }
  ok(day.held, 'the day is held by hand on Tatooine');
  day.follow(rori);
  day.update(dt, false);
  const off = (rori.T - realDays(wall)) / rori.dayDays;
  ok(day.held && Math.abs(off) < 0.5 + 1e-9, `after a travel to Rori with the hour still held, Rori's sky time is within half of Rori's own day of the real clock (${off.toFixed(4)} of a day), not whole days off`);
  day.release();
  // The walk home is the shared clock's own catch-up (`dayTune.catchUp` times the day's rate, then its ease): some minutes.
  for (let i = 0; i < 20000; i++) {
    wall += 1000 / 30;
    day.update(1 / 30, false);
  }
  ok(Math.abs(rori.T - realDays(wall)) < 1e-6, `handed back, it walks home to the real clock exactly (${((rori.T - realDays(wall)) * 86400).toExponential(2)} s off)`);
  day.follow(null);
}

// ---------------------------------------------------------------- Yavin 4: Prime held still, its noon eclipse, its giantshine
{
  const prime = yavin.items.findIndex((it) => it.name === 'Yavin Prime');
  ok(prime >= 0 && yavin.items[prime].holdsStill && yavin.items[prime].slot === 'extra', "Yavin Prime is the giant Yavin 4 is locked to (it holds still), an extra place with no SWG card (maker L hangs its card)");
  const base = Math.floor(WALL / (yavin.lengthSeconds * 1000) + yavin.phase);
  const rec = { count: base };
  let minShare = 2;
  let minHour = -1;
  let sunAtMin = 0;
  let mostWander = 0;
  let fullest = 0;
  let fullHour = -1;
  const first = new Float64Array(3);
  rec.count = base;
  yavin.at(rec);
  for (let k = 0; k < 3; k++) first[k] = yavin.dir[3 * prime + k];
  for (let i = 0; i <= 2880; i++) {
    rec.count = base + i / 2880;
    yavin.at(rec);
    mostWander = Math.max(mostWander, angle(first, 0, yavin.dir, 3 * prime));
    if (yavin.sunShare < minShare) {
      minShare = yavin.sunShare;
      minHour = yavin.hour;
      sunAtMin = upDeg(yavin.sun.y);
    }
    if (yavin.lit[prime] > fullest) {
      fullest = yavin.lit[prime];
      fullHour = yavin.hour;
    }
  }
  ok(mostWander < 4.5, `Prime stands still in Yavin 4's sky all day, swinging only by the draft's wobble of 2 degrees (most ${mostWander.toFixed(2)} degrees off)`);
  ok(minShare < 0.01 && sunAtMin > 10, `once a day it hides the sun (its share of light ${minShare.toFixed(4)}) with the sun well up (${sunAtMin.toFixed(1)} degrees, at ${minHour.toFixed(2)} of Yavin 4's own clock: the near point's noon, the play area 50 degrees east of it)`);
  // The cover is of the disc the game draws (the star table's 0.25 degrees in radius times the size dial, and since the sky
  // round's maker L by the star's true distance against its mean, `shade.sunScale`), so the light first dims as Prime meets
  // that disc, not while the drawn sun stands clear of it: with the eclipse band at nought (an airless cut) at Prime's limb,
  // and with the band at its start (Prime has air: the sky round's E) at the band's outer edge, the limb times one and its
  // air's depth times the band (`skyShade.ts`).
  const firstDimAt = (): { at: number; touch: number } => {
    let firstDim = -1;
    for (let i = 0; i <= 28800 && firstDim < 0; i++) {
      rec.count = base + (minHour / 24 - 0.1) + i / 144000;
      yavin.at(rec);
      if (yavin.sunShare < 1) firstDim = i;
    }
    return { at: firstDim, touch: angle(yavin.dir, 3 * yavin.casterJ, yavin.dir, 3 * prime) };
  };
  const bandWas = SHADE_TUNE.band;
  SHADE_TUNE.band = 0;
  const cut = firstDimAt();
  const sunDrawn = 0.25 * DISC_TUNE.size * yavin.shade!.sunScale;
  const edge = sunDrawn + yavin.sizeNow[prime] / 2;
  ok(cut.at > 0 && Math.abs(cut.touch - edge) < 0.05, `with the eclipse band at nought the light first dims where Prime's limb meets the drawn sun: ${cut.touch.toFixed(3)} degrees apart against the two radii's ${edge.toFixed(3)}`);
  SHADE_TUNE.band = bandWas;
  const banded = firstDimAt();
  const bandEdge = sunDrawn + (yavin.sizeNow[prime] / 2) * (1 + yavin.shade!.air[8 * prime + 1] * SHADE_TUNE.band);
  ok(banded.at > 0 && banded.at < cut.at && Math.abs(banded.touch - bandEdge) < 0.05, `with the band at its start (${SHADE_TUNE.band}) the light first dims where Prime's air band meets the drawn sun: ${banded.touch.toFixed(3)} degrees apart against ${bandEdge.toFixed(3)}, earlier than the bare limb`);
  rec.count = base + minHour / 24;
  yavin.at(rec);
  const day = new DayCycle(0, 1);
  wall = WALL - (WALL / 1000 / yavin.lengthSeconds + yavin.phase - Math.floor(WALL / 1000 / yavin.lengthSeconds + yavin.phase)) * yavin.lengthSeconds * 1000 + (minHour / 24) * yavin.lengthSeconds * 1000;
  day.follow(yavin);
  day.update(0, false);
  ok(Math.abs(day.time * 24 - minHour) < 0.01 && day.daylight < 0.02 && day.sunDir.y > 0.17, `the day under it is dark at that hour (daylight ${day.daylight.toFixed(4)}, the sun ${upDeg(day.sunDir.y).toFixed(1)} degrees up)`);
  day.follow(null);
  ok(fullest > 0.99, `Prime is full once a day (lit ${fullest.toFixed(4)} at ${fullHour.toFixed(2)}), half a day from its eclipse`);
  rec.count = base + fullHour / 24;
  yavin.at(rec);
  ok(yavin.nightJ === prime && yavin.moonShare > 1, `by night Prime is the brightest body and lights the night ${yavin.moonShare.toFixed(2)} times SWG's nearly full moon (giantshine, its area against the moon's)`);
  ok(yavin.moonTint[0] > yavin.moonTint[1] && yavin.moonTint[1] > yavin.moonTint[2], `in its own orange-red (${Array.from(yavin.moonTint, (v) => v.toFixed(3)).join(', ')})`);
  const lit = yavin.moonShare;
  tuneMotion({ giantshine: 0.5 });
  yavin.at(rec);
  ok(Math.abs(yavin.moonShare - (lit - 0.5 * yavin.lit[prime] * (30 / ((2 * Math.atan(0.5 / 3)) / DEG)) ** 2)) < 1e-9, 'the giantshine dial scales the giant\'s part of it alone');
  tuneMotion({ giantshine: 1, tint: 0 });
  yavin.at(rec);
  ok(yavin.moonTint[0] === 1 && yavin.moonTint[1] === 1 && yavin.moonTint[2] === 1, 'the tint dial at 0 leaves the night light white, as SWG\'s moon is');
  tuneMotion({ tint: 1 });
}

// ---------------------------------------------------------------- Tatooine's pair
{
  ok(tat.casterJ >= 0 && tat.secondJ >= 0 && tat.items[tat.casterJ].name === 'Tatoo I' && tat.items[tat.secondJ].name === 'Tatoo II', 'Tatooine\'s pair is one body of two suns, Tatoo I casting');
  const base = Math.floor(WALL / (tat.lengthSeconds * 1000) + tat.phase);
  const rec = { count: base };
  const want = (0.32 + 0.24) * DISC_TUNE.size + 1.5;
  let worstGap = 0;
  let riseA = -1;
  let riseB = -1;
  let setA = -1;
  let setB = -1;
  let pa = false;
  let pb = false;
  for (let i = 0; i <= 4800; i++) {
    rec.count = base + i / 4800;
    tat.at(rec);
    const sep = angle(tat.dir, 3 * tat.casterJ, tat.dir, 3 * tat.secondJ);
    worstGap = Math.max(worstGap, Math.abs(sep - want));
    const a = tat.sun.y > 0;
    const b = tat.sun2.y > 0;
    if (i > 0) {
      if (a && !pa) riseA = i;
      if (b && !pb) riseB = i;
      if (!a && pa) setA = i;
      if (!b && pb) setB = i;
    }
    pa = a;
    pb = b;
  }
  ok(worstGap < 1e-9, `the two suns stand the system's 1.5 degrees apart between the discs' edges as the game draws them (0.32 and 0.24 in radius), centre to centre ${want.toFixed(2)}, at every moment (worst ${worstGap.toExponential(2)})`);
  ok(want > 0.32 + 0.24, 'so they never overlap');
  ok(riseB > riseA && setB < setA && riseA > 0 && setA > 0, `the second rises after the caster and sets before it (rises ${(riseA / 200).toFixed(2)} and ${(riseB / 200).toFixed(2)}, sets ${(setA / 200).toFixed(2)} and ${(setB / 200).toFixed(2)} of Tatooine's 24 hours)`);
  DISC_TUNE.size = 2;
  rec.count = base + 0.5;
  tat.at(rec);
  ok(Math.abs(angle(tat.dir, 3 * tat.casterJ, tat.dir, 3 * tat.secondJ) - ((0.32 + 0.24) * 2 + 1.5)) < 1e-9, 'the disc size dial widens the pair with the discs, the gap between their edges kept');
  DISC_TUNE.size = 1;
}

// ---------------------------------------------------------------- Naboo and Rori together
{
  const nb = naboo as unknown as { state: { R: Float64Array }; items: SkyMotion['items']; dir: Float64Array; at(d: { count: number }): void; T: number };
  const rr = rori as unknown as typeof nb;
  wall = WALL + 5_432_101;
  sharedClock.none();
  const dn = new DayCycle(0, 1);
  const dr = new DayCycle(0, 1);
  dn.follow(naboo);
  dr.follow(rori);
  dn.update(0, false);
  dr.update(0, false);
  ok(Math.abs(naboo.T - rori.T) < 1e-9, `two browsers at one shared moment, one on Naboo and one on Rori, draw one system at one time (${naboo.T.toFixed(9)} and ${rori.T.toFixed(9)})`);
  ok(Math.abs(dn.time - dr.time) > 1e-3, `while each world keeps its own hour (${(dn.time * 24).toFixed(3)} on Naboo, ${(dr.time * 24).toFixed(3)} on Rori)`);
  // Rori in Naboo's sky and Naboo in Rori's, each turned back into the system's space: opposite ways along one line.
  const ri = nb.items.findIndex((it) => it.body === 'rori');
  const ni = rr.items.findIndex((it) => it.body === 'naboo');
  const back = (m: typeof nb, j: number): number[] => {
    const R = m.state.R;
    const x = m.dir[3 * j];
    const y = m.dir[3 * j + 1];
    const z = m.dir[3 * j + 2];
    return [R[0] * x + R[3] * y + R[6] * z, R[1] * x + R[4] * y + R[7] * z, R[2] * x + R[5] * y + R[8] * z];
  };
  const a = back(nb, ri);
  const b = back(rr, ni);
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  ok(dot < -0.9999999, `from Rori, Naboo stands exactly where Naboo's sky puts Rori, the other way along one line (cosine ${dot.toFixed(9)})`);
  dn.follow(null);
  dr.follow(null);
}

// ---------------------------------------------------------------- a world not applied: bit for bit
{
  const run = (follow: boolean): number[] => {
    wall = WALL;
    sharedClock.none();
    const d = new DayCycle(0.4, 1.1);
    d.swg = true;
    if (follow) d.follow(null);
    const out: number[] = [];
    for (let f = 0; f < 4000; f++) {
      wall += 16;
      if (f === 1000) d.time = 0.8;
      d.update(1 / 60, f > 2500 && f < 2600);
      if (f % 7 === 0) out.push(d.time, d.count, d.sunDir.x, d.sunDir.y, d.sunDir.z, d.moonDir.x, d.moonDir.y, d.lightDir.z, d.daylight, d.sunset, d.normalized, d.ratio, d.isDay ? 1 : 0, d.colorIndex);
    }
    return out;
  };
  const a = run(false);
  const b = run(true);
  ok(a.length === b.length && a.every((v, i) => Object.is(v, b[i])), `a world no system holds keeps today's day to the bit (${a.length} numbers over 4,000 frames, a written hour and the fast key among them)`);
  ok(skyMotionFor({}, 'tatooine', 'tatooine', SKY) === null && skyMotionFor(undefined, 'tatooine', 'tatooine', SKY) === null, 'no file, or a file applying nothing, makes no motion');
  ok(SKY_MOTION.now === null, 'and the drawing reads none');
}

// ---------------------------------------------------------------- the hours of __debug.sky, version 1, the dials
{
  const base = Math.floor(WALL / (tat.lengthSeconds * 1000) + tat.phase);
  const noon = motionHourTime(tat, 'noon', base + 0.1, 3);
  const dawn = motionHourTime(tat, 'dawn', base + 0.1, 3);
  const dusk = motionHourTime(tat, 'dusk', base + 0.1, 3);
  const rec = { count: base + dawn };
  tat.at(rec);
  const dawnUp = upDeg(tat.sun.y);
  rec.count = base + dusk;
  tat.at(rec);
  const duskUp = upDeg(tat.sun.y);
  ok(noon === 0.5 && motionHourTime(tat, 'night', base, 3) === 0, "under a system's own day, noon and night are its sun's meridian (12:00 and midnight)");
  ok(Math.abs(dawnUp - 3) < 1e-6 && Math.abs(duskUp - 3) < 1e-6 && dawn < 0.5 && dusk > 0.5, `dawn and dusk where its casting sun stands 3 degrees up, rising (${(dawn * 24).toFixed(3)}) and setting (${(dusk * 24).toFixed(3)})`);
  const v1 = skyMotionFor({ 'v1:dathomir': draftV1For('dathomir') }, 'dathomir', 'dathomir', SKY)!;
  ok(!!v1 && !v1.ownsDay && Number.isNaN(motionHourTime(v1, 'noon', 0, 3)), "a first-round sky keeps the game's day: its hours are the game's path's");
  const runV1 = (follow: boolean): number[] => {
    wall = WALL;
    sharedClock.none();
    const d = new DayCycle(0.4, 1.1);
    d.swg = true;
    if (follow) d.follow(v1);
    const out: number[] = [];
    for (let f = 0; f < 600; f++) {
      wall += 16;
      d.update(1 / 60, false);
      out.push(d.time, d.count, d.sunDir.x, d.sunDir.y, d.normalized);
    }
    return out;
  };
  const p = runV1(false);
  const q = runV1(true);
  ok(p.every((v, i) => Object.is(v, q[i])), "under a first-round sky the day's time, count and sun are the game's own to the bit (its bodies and night light are the system's)");
  // (the sky round's maker P: a fourth, size follows distance)
ok(SKY_DIAL_GROUPS.includes(motionDialGroup) && motionDialGroup().dials.length === 4, 'the motion\'s dials join the sky\'s set in the debug menu');
  const said = tuneMotion({ giantshine: 9, nope: 1, tint: 'x' });
  ok(MOTION_TUNE.giantshine === 4 && said.length === 3, `each dial is held to its range and a wrong word said (${said.join('; ')})`);
  tuneMotion({ giantshine: 1 });
  ok(MOTION_TUNE.giantshine === 1 && MOTION_TUNE.tint === 1 && MOTION_TUNE.eclipse === 1, 'the dials start at 1, 1, 1 (the file says why)');
}

// ---------------------------------------------------------------- the epoch
ok(EPOCH_MS === Date.UTC(2026, 0, 1), "the system's real clock counts from 1 January 2026, as the viewer's");

console.log(`\nskyMotion: ${checks} checks passed`);
