// The light between the sky's bodies (the GPU port's sky round, maker L: `src/sky/system/skyShade.ts`, `systemSuns.ts`, the
// shade's lines in `skyMotion.ts`, `airRun.ts`, `airTables.ts` and `build.js`), the game's own code under node, over the
// viewer's own drafts and two scratch systems (made-up sizes, no converted file):
//   - D: a moon's shadow on a giant (a dark spot under it, the rest lit), a moon in a giant's shadow (red and dim from the
//     giant's air), the world one stands on casting on its moons, four casters at most;
//   - E: an eclipse through air fades over a band wider than the bare limb and reddens; an airless moon cuts the sun across
//     its own disc alone, grey (every channel alike), exactly the old cover;
//   - F: a small moon's total eclipse leaves the air lit (deep twilight, the direct light nought) with the sky brighter toward
//     the horizon (the card's rule at a far place against the eye's), a giant's swallows the air (near night, its red ring);
//   - G: a moonless night under an applied system keeps the floor's light, from overhead, and nought with the floor at nought;
//   - H: the applied system's suns (colour as a temperature, brightness, size against SWG's sun card) for the world it was set
//     for alone, the table for every other and once cleared; the colour's temperature found back from a black body's colour;
//   - the card's text: the sky view's and the haze's samples take the shade, off exactly one;
//   - nothing allocated by a frame of the motion with its shade and of the air's run under it, in twelve fresh processes.
//
// Run: node tools/swg/tests/skyShade.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { draftSystem } from '../../../src/sky/system/drafts.js';
import { SKY_MOTION, skyMotionFor, type SkyMotion } from '../../../src/sky/system/skyMotion.ts';
import { SHADE_AIR, SHADE_TUNE, SHADE_STRIDE, airShadeAt, bandAirOf, tuneShade } from '../../../src/sky/system/skyShade.ts';
import { SYSTEM_SUNS_SAID, clearSystemSuns, systemSunsOf, useSystemSuns } from '../../../src/sky/system/systemSuns.ts';
import { SYSTEM_SUNS, STAR_SYSTEMS, casterOf, kelvinOfColour, kelvinToLinear, secondOf } from '../../../src/sky/stars.ts';
import { worldRecord } from '../../../src/sky/air/airParams.ts';
import { AIR } from '../../../src/sky/air/airApi.ts';
import { AirRun } from '../../../src/sky/air/airRun.ts';
import { MOON_SHARE } from '../../../src/sky/air/airTwin.ts';
import { DISC_TUNE } from '../../../src/sky/skyDials.ts';
import { shadeDialGroup } from '../../../src/sky/system/shadeDials.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ALLOC = process.argv.includes('--alloc');
let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  if (!ALLOC) console.log(`ok   ${msg}`);
};
const lum = (a: ArrayLike<number>): number => 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];

/** Stand-in skies: Endor's places (its sun, its two moons, its giant's picture) and a plain world's (a sun and a moon). */
const ENDOR_SKY = { sun: { size: 0.6 }, moon: { size: 0.8 }, supplementalMoon: { size: 0.3 }, celestials: [{ size: 1.2, image: { file: 'sky/cels_endor.png' } }] };
const PLAIN_SKY = { sun: { size: 0.6 }, moon: { size: 0.5 } };

/**
 * A scratch system: a sun, `naboo` on a circular orbit of 1 AU, and one airless moon of it in its plane at the Moon's distance,
 * drawn `moonDeg` across (0.56: a little larger than the sun's 0.54, a total eclipse with a small umbra, as ours). Every new
 * moon covers the sun from the world's middle.
 */
function smallMoonSystem(moonDeg: number, lon = 0): Record<string, unknown> {
  return {
    version: 2,
    id: 'scratch',
    name: 'Scratch',
    bodies: [
      { id: 'sun', kind: 'star', name: 'Sun', places: ['naboo:sun'], colour: '#fff2dc' },
      { id: 'w', kind: 'planet', name: 'World', parent: 'sun', radius: 1, period: 365, tilt: 0, start: 0 },
      { id: 'moon', kind: 'moon', name: 'Small moon', parent: 'w', radius: 0.00257, period: 27.3, tilt: 0, start: 30, size: moonDeg },
    ],
    grounds: [{ world: 'naboo', body: 'w', lat: 0, lon, dayHours: 4, season: 0 }],
  };
}

/** The motion's count at which a sun's direct light is least over a span (`n` steps), and that light. */
function leastLight(m: SkyMotion, from: number, to: number, n: number): { count: number; light: number } {
  const rec = { count: from };
  let best = { count: from, light: 2 };
  for (let i = 0; i <= n; i++) {
    rec.count = from + ((to - from) * i) / n;
    m.at(rec);
    const l = lum(m.shade!.direct1);
    if (l < best.light) best = { count: rec.count, light: l };
  }
  return best;
}

if (!ALLOC) {
  // ---------------------------------------------------------------- H: the suns from the system, and the table untouched
  clearSystemSuns();
  const tableTat = STAR_SYSTEMS.tatoo.suns;
  ok(casterOf('tatooine') === tableTat[0] && secondOf('tatooine') === tableTat[1] && SYSTEM_SUNS.caster === null, "with no system's word the suns are the table's own records, as before the round");
  for (const k of [2500, 4600, 5778, 9500, 20000]) {
    const c = [1, 1, 1];
    kelvinToLinear(k, c);
    const m = Math.max(c[0], c[1], c[2]);
    const enc = (v: number): number => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
    const hex = '#' + [c[0], c[1], c[2]].map((v) => enc(v / m).toString(16).padStart(2, '0')).join('');
    const back = kelvinOfColour(hex)!;
    ok(Math.abs(back - k) / k < 0.04, `a black body of ${k} K shown as ${hex} is read back as ${back} K`);
  }
  ok(kelvinOfColour(null) === null && kelvinOfColour('red') === null, 'no colour, no temperature');
  const tatoo = { tatoo: draftSystem('tatoo') };
  const TAT_SKY = { sun: { size: 0.6 }, supplementalSun: { size: 0.55 }, moon: { size: 0.5 }, supplementalMoon: { size: 0.25 } };
  const s = systemSunsOf(tatoo, 'tatooine', 'tatooine', TAT_SKY)!;
  const sunCard = (2 * Math.atan(0.6 / 3) * 180) / Math.PI;
  ok(!!s && !!s.second && Math.abs(s.caster.radiusDeg - tableTat[0].radiusDeg) < 1e-4, `Tatoo I with no size of its own keeps the table's disc (${s.caster.radiusDeg})`);
  ok(Math.abs(s.second!.radiusDeg - (tableTat[0].radiusDeg * 14.6) / sunCard) < 1e-4, `Tatoo II's 14.6 against SWG's sun card of ${sunCard.toFixed(2)} degrees: ${s.second!.radiusDeg.toFixed(4)} (the table had ${tableTat[1].radiusDeg})`);
  ok(s.second!.strength === 0.8 && s.caster.strength === 1 && s.caster.kelvin > 5000 && s.caster.kelvin < 7000 && s.second!.kelvin < s.caster.kelvin, `their brightness the system's (1 and 0.8) and their colours as temperatures (${s.caster.kelvin} K and ${s.second!.kelvin} K)`);
  useSystemSuns(tatoo, 'tatooine', 'tatooine', TAT_SKY);
  ok(casterOf('tatooine').kelvin === s.caster.kelvin && secondOf('tatooine')!.radiusDeg === s.second!.radiusDeg && casterOf('naboo') === STAR_SYSTEMS.naboo.suns[0], "set at a screen, Tatooine's suns are the system's and every other world's the table's");
  ok(SYSTEM_SUNS_SAID.system === 'tatoo' && Array.isArray(SYSTEM_SUNS_SAID.table) && SYSTEM_SUNS_SAID.table.length === 2, 'the console says the system and the table it stood in for');
  const recSys = worldRecord('tatooine');
  clearSystemSuns();
  const recTab = worldRecord('tatooine');
  ok(recSys[21] === 1 && recTab[21] === 1 && recSys[18] !== recTab[18] && casterOf('tatooine') === tableTat[0], "the world's record carried the system's colour while set, the table's once cleared");
  useSystemSuns({}, 'tatooine', 'tatooine', TAT_SKY);
  ok(SYSTEM_SUNS.caster === null, 'a file applying no system for the world leaves the table');

  // ---------------------------------------------------------------- the air's band
  const band = new Float64Array(8);
  bandAirOf(null, band, 0);
  ok(band.every((v) => v === 0), 'no record, no air: nothing in its band');
  bandAirOf(worldRecord('endor'), band, 0);
  ok(band[0] === 1 && band[2] > band[3] && band[3] > band[4] && band[5] > band[2] && band[7] > band[4], `a world's air lets through its inner band reddened (${band[2].toFixed(3)}, ${band[3].toFixed(3)}, ${band[4].toFixed(4)}) and its outer more (${band[5].toFixed(3)}, ${band[6].toFixed(3)}, ${band[7].toFixed(3)})`);

  // ---------------------------------------------------------------- E and F: a small airless moon's total eclipse
  // the play area's longitude set so the new moon falls at its noon (found once, the system made again)
  const first = skyMotionFor({ scratch: smallMoonSystem(0.56) }, 'naboo', 'naboo', PLAIN_SKY)!;
  const f0 = leastLight(first, 100, 100 + 27.3 / first.dayDays, 4000);
  first.at({ count: f0.count });
  const small = skyMotionFor({ scratch: smallMoonSystem(0.56, -(first.hour - 12) * 15) }, 'naboo', 'naboo', PLAIN_SKY)!;
  ok(!!small && !!small.shade, 'the scratch system has its motion and its shade');
  let at = leastLight(small, 99, 101 + 27.3 / small.dayDays, 8000);
  at = leastLight(small, at.count - 0.004, at.count + 0.004, 4000);
  const rec = { count: at.count };
  small.at(rec);
  ok(small.sun.y > 0.9, `the scratch new moon stands at the play area's noon (the sun ${((Math.asin(small.sun.y) * 180) / Math.PI).toFixed(1)} degrees up)`);
  const sh = small.shade!;
  ok(lum(sh.direct1) < 0.002, `at the small moon's middle of totality the sun's direct light is nought (${lum(sh.direct1).toExponential(2)})`);
  ok(lum(sh.air1) > 1e-5 && lum(sh.air1) < 0.01, `while the air keeps a share of its light (${lum(sh.air1).toExponential(2)}, some ${(lum(sh.air1) * 100000).toFixed(0)} lux of a 100,000 lux day): deep twilight from the penumbra round the small umbra, not night`);
  ok(Math.abs(small.daylight - lum(sh.air1)) < 1e-9, `the day's daylight is the air's (${small.daylight.toFixed(4)})`);
  const near = new Float64Array(3);
  const far = new Float64Array(3);
  airShadeAt(sh.gpu, 0, 0, 0.001, 0, near);
  airShadeAt(sh.gpu, 0, 1200, 0, 0, far);
  ok(sh.gpu[24] === 1 && lum(far) > 4 * lum(near) + 0.01, `the card's sky is drawn with the shadow, brighter toward the horizon (1,200 km out ${lum(far).toFixed(3)} against the eye's ${lum(near).toFixed(4)})`);
  // partial: grey, the old cover exactly
  let partial = -1;
  for (let i = 1; i < 400 && partial < 0; i++) {
    rec.count = at.count - (i * 0.0005) / small.dayDays;
    small.at(rec);
    const l = lum(sh.direct1);
    if (l > 0.3 && l < 0.7) partial = rec.count;
  }
  ok(partial > 0 && sh.direct1[0] === sh.direct1[1] && sh.direct1[1] === sh.direct1[2], `an airless moon's partial eclipse is grey: every channel alike (${sh.direct1[0].toFixed(4)})`);
  {
    // the old cover's own arithmetic over the drawn discs (skyMotion.ts' coverOf before the round)
    const k = small.casterJ;
    const j = small.items.findIndex((it) => it.name === 'Small moon');
    const c = small.dir[3 * k] * small.dir[3 * j] + small.dir[3 * k + 1] * small.dir[3 * j + 1] + small.dir[3 * k + 2] * small.dir[3 * j + 2];
    const d = Math.acos(Math.min(1, Math.max(-1, c)));
    const a = ((STAR_SYSTEMS.naboo.suns[0].radiusDeg * Math.PI) / 180) * DISC_TUNE.size * sh.sunScale;
    const b = (small.sizeNow[j] * Math.PI) / 360;
    const ca = (d * d + a * a - b * b) / (2 * d * a);
    const cb = (d * d + b * b - a * a) / (2 * d * b);
    const kk = (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b);
    const covered = a * a * Math.acos(ca) + b * b * Math.acos(cb) - 0.5 * Math.sqrt(kk);
    const old = 1 - covered / (Math.PI * a * a);
    ok(Math.abs(old - sh.direct1[0]) < 1e-12, `and its light is the lens of the two drawn discs (${old.toFixed(6)} against ${sh.direct1[0].toFixed(6)})`);
  }

  // ---------------------------------------------------------------- E and F: Endor's giant (air) over the sun, and its band
  const endor = skyMotionFor({ endor: draftSystem('endor') }, 'endor', 'endor', ENDOR_SKY)!;
  const es = endor.shade!;
  const giant = endor.items.findIndex((it) => it.kind === 'giant');
  const g0 = leastLight(endor, 200, 201, 2000);
  ok(g0.light < 0.001, `Endor's giant takes the sun once a day (${g0.light.toExponential(2)} of its light at its least)`);
  rec.count = g0.count;
  endor.at(rec);
  // (the sky round's fixer) the light its air bends into its shadow is the ring's (`ringSky`), drawn about its limb and laid on the
  // land as the sky's: nothing comes from the sun's place, and our air scatters none of it as if it did
  ok(es.occluder1 === giant && lum(es.air1) < 1e-6 && lum(es.direct1) === 0 && es.ringSky[5] > es.ringSky[6] && es.ringSky[6] > es.ringSky[7] && es.ringSky[7] > 0, `in the giant's shadow the air is swallowed (${lum(es.air1).toExponential(2)}) and nothing comes from the sun's place, lit by its red ring alone (${Array.from(es.ringSky.subarray(5, 8), (v) => v.toExponential(1)).join(', ')})`);
  // the fade: how long the light takes from 99% to 1%, with the band and with it at nought; its colour midway
  const fade = (): { frames: number; redOverBlue: number } => {
    let frames = 0;
    let rb = 0;
    const r2 = { count: 0 };
    for (let i = 0; i <= 6000; i++) {
      r2.count = g0.count - 0.06 + (0.06 * i) / 6000;
      endor.at(r2);
      const l = lum(es.direct1);
      if (l < 0.99 && l > 0.01) {
        frames++;
        if (l < 0.6 && l > 0.4) rb = es.direct1[0] / Math.max(es.direct1[2], 1e-9);
      }
    }
    return { frames, redOverBlue: rb };
  };
  const banded = fade();
  tuneShade({ band: 0 });
  const bare = fade();
  tuneShade({ band: 30 });
  ok(banded.frames > 3 * bare.frames, `through the giant's air the sun fades over ${banded.frames} steps against ${bare.frames} with the band at nought (an airless cut)`);
  ok(banded.redOverBlue > 1.5, `and reddens as it goes (red over blue ${banded.redOverBlue.toFixed(2)} at half light)`);
  {
    // (the sky round's fixer) at totality the disc shows nothing of the light the giant's air bends into its shadow: that light is
    // the ring at its limb (`ringSky`), about the giant's middle, from its disc out to its band's top, reddened by its air
    rec.count = g0.count;
    endor.at(rec);
    const rg = es.ringSky;
    const g3 = 3 * giant;
    const onGiant = rg[0] * endor.dir[g3] + rg[1] * endor.dir[g3 + 1] + rg[2] * endor.dir[g3 + 2];
    const ro = (endor.sizeNow[giant] * Math.PI) / 360;
    const A = 8 * giant;
    const want = [SHADE_TUNE.ring * es.air[A + 2], SHADE_TUNE.ring * es.air[A + 3], SHADE_TUNE.ring * es.air[A + 4]];
    ok(lum(es.disc1) === 0 && lum(es.direct1) === 0, `at totality the drawn disc and the land's direct light show nought of the sun (${lum(es.disc1).toExponential(2)})`);
    ok(onGiant > 0.999999 && Math.abs(rg[3] - ro) < 1e-12 && rg[4] > rg[3] && rg[5] > rg[7] && rg[5] > 0 && Math.abs(lum(rg.subarray(5, 8)) - lum(want)) < 1e-9 * lum(want), `and the ring stands about the giant's middle from its disc (${((rg[3] * 180) / Math.PI).toFixed(2)} degrees) to its band's top (${((rg[4] * 180) / Math.PI).toFixed(2)}), red over blue ${(rg[5] / Math.max(rg[7], 1e-30)).toFixed(1)}, its light the share the giant's air bends round it (\`ring\` times its inner band's light)`);
    ok(es.gpu[14] === 0, "the card's march scatters none of the ring's light as if from the sun's place (its record's ring nought)");
    // the inner share is a dial: its band's colours worked again from the records kept, none of it in a frame of its own
    const before = es.air[8 * giant + 2];
    tuneShade({ innerShare: 0.6 });
    endor.at(rec);
    const after = es.air[8 * giant + 2];
    tuneShade({ innerShare: 1 / 3 });
    endor.at(rec);
    ok(after > before && Math.abs(es.air[8 * giant + 2] - before) < 1e-15, `the band's inner part is a dial (its red through it ${before.toFixed(4)} at a third, ${after.toFixed(4)} at 0.6, back again)`);
  }
  {
    // (the sky round's fixer) the airless moon's totality draws no ring
    rec.count = at.count;
    small.at(rec);
    const rs = small.shade!.ringSky;
    ok(rs[5] === 0 && rs[6] === 0 && rs[7] === 0, 'an airless moon over the sun has no ring of bent light');
  }
  {
    // (the sky round's fixer, I) the viewer's own model runs the same shade (`modelShadeOf`): at Endor's totality its air's share,
    // direct light and the giant's casters are the game's motion's, from the model and its state alone
    const { compileSystem, makeSkyState, skyAtNext } = await import('../../../src/sky/system/system.js');
    const { modelPoseOf } = await import('../../../src/sky/system/bodyPose.ts');
    const { modelShadeOf } = await import('../../../src/sky/system/modelShade.ts');
    const { skyPlacesOf, MOTION_TUNE } = await import('../../../src/sky/system/skyMotion.ts');
    const places = skyPlacesOf('endor', ENDOR_SKY);
    const model = compileSystem(draftSystem('endor'), (pid: string) => places.get(pid)?.sizeDeg ?? null, (pid: string) => places.get(pid)?.sheet === true, { world: 'endor', placeExists: (pid: string) => places.has(pid) }) as Any;
    const st = makeSkyState(model) as Any;
    rec.count = g0.count;
    endor.at(rec);
    st.next = endor.T;
    skyAtNext(model, st);
    const mp = modelPoseOf(model, st, MOTION_TUNE.distanceSize);
    const ms = modelShadeOf(model, st, 'endor', mp.sizes, mp.dist.mean)!;
    ok(!!ms && Math.abs(ms.airLight - endor.daylight) < 1e-9 && Math.abs(lum(ms.direct1) - lum(es.direct1)) < 1e-9 * Math.max(lum(es.direct1), 1e-12), `the viewer's own model at the game's moment says the game's eclipse (daylight ${ms.airLight.toExponential(3)} against ${endor.daylight.toExponential(3)}), where the model's own cover says ${st.daylight.toFixed(4)}`);
    let same = true;
    for (let j = 0; j < endor.m; j++) if (ms.items[j].n !== es.items[j].n) same = false;
    ok(same, "and every body's casters are the game's");
  }

  // ---------------------------------------------------------------- D: shadows on the bodies
  // a moon's shadow on the giant, and a moon in the giant's shadow, over Endor's days
  const kef = endor.items.findIndex((it) => it.place === 'endor:moon');
  let spot: { count: number } | null = null;
  let inShadow: { count: number } | null = null;
  const r3 = { count: 0 };
  for (let i = 0; i < 40000 && (!spot || !inShadow); i++) {
    r3.count = 300 + i * 0.0025;
    endor.at(r3);
    const gs = es.items[giant];
    for (let q = 0; q < gs.n; q++) if (gs.who[q] === kef && !spot) spot = { count: r3.count };
    const ks = es.items[kef];
    for (let q = 0; q < ks.n; q++) if (ks.who[q] === giant && !inShadow) inShadow = { count: r3.count };
  }
  ok(!!spot && !!inShadow, `over Endor's days Kef Bir's shadow crosses the giant (from ${spot?.count.toFixed(3)}) and Kef Bir passes through the giant's (from ${inShadow?.count.toFixed(3)})`);
  if (spot) {
    // into the deep of it, then the light at the point under Kef Bir against a point on the far limb
    let best = { count: spot.count, light: 2 };
    for (let i = 0; i < 4000; i++) {
      r3.count = spot.count + i * 0.0002;
      endor.at(r3);
      const gs = es.items[giant];
      const q = Array.from(gs.who.slice(0, gs.n)).indexOf(kef);
      if (q < 0) continue;
      const c = gs.c;
      const o = q * SHADE_STRIDE;
      const l = Math.hypot(c[o], c[o + 1], c[o + 2]);
      const out = new Float64Array(3);
      const k3 = 3 * giant;
      es.lightAt(giant, c[o] / l, c[o + 1] / l, c[o + 2] / l, endor.light[k3], endor.light[k3 + 1], endor.light[k3 + 2], out);
      if (lum(out) < best.light) best = { count: r3.count, light: lum(out) };
    }
    r3.count = best.count;
    endor.at(r3);
    const gs = es.items[giant];
    const q = Array.from(gs.who.slice(0, gs.n)).indexOf(kef);
    const c = gs.c;
    const o = q * SHADE_STRIDE;
    const l = Math.hypot(c[o], c[o + 1], c[o + 2]);
    const k3 = 3 * giant;
    const under = new Float64Array(3);
    const away = new Float64Array(3);
    es.lightAt(giant, c[o] / l, c[o + 1] / l, c[o + 2] / l, endor.light[k3], endor.light[k3 + 1], endor.light[k3 + 2], under);
    es.lightAt(giant, -c[o] / l, -c[o + 1] / l, -c[o + 2] / l, endor.light[k3], endor.light[k3 + 1], endor.light[k3 + 2], away);
    ok(lum(under) < 0.5 && lum(away) === 1 && under[0] === under[2], `Kef Bir's shadow on the giant: the point under it gets ${lum(under).toFixed(3)} of the light, grey (Kef Bir has no air), the far side all of it`);
  }
  if (inShadow) {
    let deep = 2;
    let deepRgb = [0, 0, 0];
    for (let i = 0; i < 4000; i++) {
      r3.count = inShadow.count + i * 0.0002;
      endor.at(r3);
      const k3 = 3 * kef;
      const out = new Float64Array(3);
      // the point of Kef Bir toward the giant (Kef Bir, drawn as SWG's 22.6-degree moon, is wider than the giant's umbra there)
      const ks = es.items[kef];
      const q = Array.from(ks.who.slice(0, ks.n)).indexOf(giant);
      if (q < 0) continue;
      const o = q * SHADE_STRIDE;
      const l = Math.hypot(ks.c[o], ks.c[o + 1], ks.c[o + 2]);
      es.lightAt(kef, ks.c[o] / l, ks.c[o + 1] / l, ks.c[o + 2] / l, endor.light[k3], endor.light[k3 + 1], endor.light[k3 + 2], out);
      if (lum(out) < deep) {
        deep = lum(out);
        deepRgb = Array.from(out);
      }
    }
    ok(deep < 0.01 && deepRgb[0] > deepRgb[2], `Kef Bir in the giant's shadow: its face toward the star gets ${deep.toExponential(2)} of the light at the deepest, red (${deepRgb.map((v) => v.toExponential(1)).join(', ')}) from the giant's air`);
  }
  // the world one stands on casts on its moons
  let worldCasts = false;
  for (let i = 0; i < 20000 && !worldCasts; i++) {
    r3.count = 300 + i * 0.005;
    endor.at(r3);
    for (let j = 0; j < endor.m && !worldCasts; j++) for (let q = 0; q < es.items[j].n; q++) if (es.items[j].who[q] === -2) worldCasts = true;
  }
  ok(worldCasts, 'the forest moon one stands on casts its own shadow on the bodies behind it');
  let most = 0;
  for (let j = 0; j < endor.m; j++) most = Math.max(most, es.items[j].n);
  ok(most <= 4, `no body takes more than four casters (${most})`);
  tuneShade({ shadows: 0 });
  endor.at(r3);
  ok(es.items.every((it) => it.n === 0), 'with the shadows at nought no body has a caster');
  tuneShade({ shadows: 1 });

  // ---------------------------------------------------------------- G and F through the air's run
  {
    const run = new AirRun('naboo', { sunElevationDegrees: 67.5, blocks: [] }, (f) => f);
    const L = { ambient: new THREE.Color(0.3, 0.3, 0.3), ambientScale: 1, shadow: new THREE.Color(), main: new THREE.Color(1, 0.9, 0.8), mainScale: 1.2, fill: new THREE.Color(0.2, 0.2, 0.2), fillScale: 0.5, bounce: new THREE.Color(0.1, 0.1, 0.1), bounceScale: 0.7, fog: new THREE.Color(0.7, 0.6, 0.5), fogDensity: 0.004, clear: new THREE.Color(0.5, 0.5, 0.6) };
    const mix = { mixLength: 0, mixBlock: () => null, mixWeights: new Float64Array(4) };
    // a night with the small moon under the horizon: the floor alone, from overhead
    let night = -1;
    for (let i = 0; i < 4000 && night < 0; i++) {
      rec.count = 50 + i * 0.01;
      small.at(rec);
      const j = small.items.findIndex((it) => it.name === 'Small moon');
      if (small.sun.y < -0.5 && small.dir[3 * j + 1] < -0.2) night = rec.count;
    }
    rec.count = night;
    small.at(rec);
    SKY_MOTION.now = small;
    const day = { sunDir: new THREE.Vector3(small.sun.x, small.sun.y, small.sun.z), moonDir: new THREE.Vector3(small.nightDir.x, small.nightDir.y, small.nightDir.z), isDay: false };
    run.heightM = 10;
    run.overcast = 0;
    run.frame(day, mix, L);
    const f = AIR.frame;
    const top = f.sunTop.r * 0.2126 + f.sunTop.g * 0.7152 + f.sunTop.b * 0.0722;
    const moonTop = f.moonTop.r * 0.2126 + f.moonTop.g * 0.7152 + f.moonTop.b * 0.0722;
    // (the sky round's fixer) the floor is light from the whole sky beside the sky's own (`floorHere`), its full moon's share at
    // the top of the air through the air straight up; the moon's light and its way stay the bodies' (the brightest's, here under
    // the land), so no glow or flare stands in empty sky
    const fh = run.twin.out.floorHere;
    run.twin.zenithNow();
    const zt = run.twin.zenithT;
    const fu = SHADE_AIR.sun;
    const want = SHADE_TUNE.floor * MOON_SHARE * lum([fu[0] * zt[0], fu[1] * zt[1], fu[2] * zt[2]]);
    const levelOn = f.level;
    ok(night > 0 && small.moonShare === 0 && moonTop === 0 && Math.abs(lum(fh) - want) < 1e-6 * want && want > 0 && Math.abs(f.moonDir.y - small.nightDir.y) < 1e-12 && levelOn >= lum(fh) * 0.999, `a moonless night keeps the floor's light from the whole sky (${(lum(fh) / (top * MOON_SHARE)).toFixed(3)} of today's full moon at the top, through the air overhead), the moon's own light nought and its way the brightest body's (${f.moonDir.y.toFixed(4)} up), the level light counting it`);
    tuneShade({ floor: 0 });
    run.frame(day, mix, L);
    ok(f.moonTop.r === 0 && f.moonTop.g === 0 && fh[0] === 0 && fh[1] === 0 && fh[2] === 0 && f.level < levelOn, 'and none with the floor at nought');
    tuneShade({ floor: 1 });
    // the small moon's totality: the direct light nought, the twin's sky lit by the air's share
    rec.count = at.count;
    small.at(rec);
    day.sunDir.set(small.sun.x, small.sun.y, small.sun.z);
    day.moonDir.set(small.nightDir.x, small.nightDir.y, small.nightDir.z);
    day.isDay = true;
    for (let i = 0; i < 12; i++) run.frame(day, mix, L);
    const sunHere = f.sunHere.r * 0.2126 + f.sunHere.g * 0.7152 + f.sunHere.b * 0.0722;
    const full = lum(SHADE_AIR.sun);
    const disc = f.sunTop.r * 0.2126 + f.sunTop.g * 0.7152 + f.sunTop.b * 0.0722;
    const sky = run.twin.out.skyUp;
    // (the sky round's fixer) the disc its own disc's share (`disc1`: the ring's light is drawn about the occluder, not here), the
    // bodies the star's full light
    const bodyTop = f.bodyTop.r * 0.2126 + f.bodyTop.g * 0.7152 + f.bodyTop.b * 0.0722;
    ok(small.sun.y > 0.2 && sunHere < 0.002 * full && lum(sky) > 0 && SHADE_AIR.on === 1 && Math.abs(full - top) < 1e-9 * top && Math.abs(disc - full * lum(small.shade!.disc1)) < 1e-6 * full && Math.abs(bodyTop - full) < 1e-9 * full, `at totality the sun's light on the land is nought (${(sunHere / full).toExponential(2)} of its top), the sky still sheds ${lum(sky).toExponential(2)}, the card's marches and the bodies take the star's full light and the disc its own disc's share alone (${(disc / full).toExponential(2)})`);
    SKY_MOTION.now = null;
    run.dispose();
  }

  // ---------------------------------------------------------------- the card's text and the look's
  {
    const tables = readFileSync(new URL('../../../src/sky/air/airTables.ts', import.meta.url), 'utf8');
    const twice = tables.split('sunAir.mul(shade1(d.mul(tm)))').length - 1;
    const twice2 = tables.split('sun2Air.mul(shade2(d.mul(tm)))').length - 1;
    ok(twice === 2 && twice2 === 2, "the sky view's and the haze's samples take each sun's shade (twice each in the card's text)");
    ok(/select\(on\.greaterThan\(0\.5\), vec3\(1\)\.sub\(vec3\(1\)\.sub\(L\)\.mul\(sv1\.w\)\), vec3\(1\)\)/.test(tables), 'off, the card multiplies by exactly one');
    const build = readFileSync(new URL('../../../src/sky/look/build.js', import.meta.url), 'utf8');
    ok(/if \(place\) LU\.shade = shadeUniforms\(\);/.test(build) && (build.match(/const SH = shadeLight\(LU, /g) ?? []).length === 4, "the look's own light takes the casters only when built for a place (the stage's programs as they were), in its four lit materials");
  }

  // ---------------------------------------------------------------- the dials
  {
    const g = shadeDialGroup();
    const keys = g.dials.map((d) => (d as { key: string }).key);
    // (the sky round's fixer: the band's inner share joined them)
    ok(keys.join(',') === 'shade.shadows,shade.band,shade.ring,shade.reachKm,shade.floor,shade.worldScale,shade.innerShare' && keys.length === Object.keys(SHADE_TUNE).length, `the debug menu's group holds every dial (${keys.length})`);
    const said = tuneShade({ band: 9999, floor: -1, nope: 1 });
    ok(SHADE_TUNE.band === 400 && SHADE_TUNE.floor === 0 && said.length === 3, `held to their ranges and said (${said.join('; ')})`);
    tuneShade({ band: 30, floor: 1 });
  }

  // ---------------------------------------------------------------- nothing allocated a frame
  const me = fileURLToPath(import.meta.url);
  type Answer = { on: number | string; off: number | string; air: number | string };
  const one = (): Promise<Answer | string> =>
    new Promise((res) => {
      const ch = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', me, '--alloc'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      ch.stdout.on('data', (b) => (out += b));
      ch.stderr.on('data', (b) => (err += b));
      ch.on('close', () => {
        try {
          res(JSON.parse(out.trim().split('\n').pop() ?? '') as Answer);
        } catch {
          res(`no answer: ${err.slice(0, 300)}`);
        }
      });
    });
  const runs: (Answer | string)[] = [];
  // twelve fresh processes in three waves of four (with this one, five node processes at once at most)
  for (let wave = 0; wave < 3; wave++) runs.push(...(await Promise.all(Array.from({ length: 4 }, one))));
  const num = (x: unknown): x is number => typeof x === 'number';
  const fine = runs.every((r) => typeof r === 'object' && num(r.on) && num(r.off) && num(r.air) && r.on - r.off < 0.05 && r.air < 0.05);
  // The motion's own frame (wave 5's `at`, through `DayCycle.fromMotion`) makes 16 bytes a world a frame while a body covers a
  // sun, at the base (34a650c) as here, with or without the shade: the shade's frame is held to add nothing to it, and the air's
  // run under an eclipsed motion to make nothing.
  ok(fine, `through eclipses the shade adds nothing to three motions' frames and the air's run under one makes nothing, in 12 of 12 fresh processes (${runs.map((r) => (typeof r === 'object' && num(r.on) && num(r.off) && num(r.air) ? `+${(r.on - r.off).toFixed(3)}/${r.air.toFixed(3)} B` : JSON.stringify(r))).join(', ')})`);
  console.log(`\nskyShade: ${checks} checks passed`);
} else {
  // ---------------------------------------------------------------- the allocation child
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as unknown as { gc: (o?: unknown) => void }).gc;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  const small = skyMotionFor({ scratch: smallMoonSystem(0.56) }, 'naboo', 'naboo', PLAIN_SKY)!;
  const endor = skyMotionFor({ endor: draftSystem('endor') }, 'endor', 'endor', ENDOR_SKY)!;
  const yavin = skyMotionFor({ yavin: draftSystem('yavin') }, 'yavin4', 'yavin4', { sun: { size: 0.6 }, moon: { size: 0.5 }, supplementalMoon: { size: 0.25 }, celestials: [{ size: 0.45, image: { file: 'sky/cels_ice_moon.png' } }] })!;
  const motions = [small, endor, yavin];
  // each followed by a real day (`DayCycle.fromMotion`, the game's frame path) walked over its eclipses: the small moon round
  // its new moon, Endor round the giant's, Yavin 4 through its day
  const base = [leastLight(small, 100, 100 + 27.3 / small.dayDays, 3000).count, leastLight(endor, 200, 201, 2000).count, 300.5];
  const { DayCycle } = await import('../../../src/world/daycycle.ts');
  const { sharedClock } = await import('../../../src/world/sharedClock.ts');
  sharedClock.none();
  const days = motions.map((m, i) => {
    const d = new DayCycle(0, 1);
    d.swg = true;
    d.follow(m);
    d.count = base[i] - 0.01;
    return d;
  });
  const run = new AirRun('naboo', { sunElevationDegrees: 67.5, blocks: [] }, (f) => f);
  const L = { ambient: new THREE.Color(0.3, 0.3, 0.3), ambientScale: 1, shadow: new THREE.Color(), main: new THREE.Color(1, 0.9, 0.8), mainScale: 1.2, fill: new THREE.Color(0.2, 0.2, 0.2), fillScale: 0.5, bounce: new THREE.Color(0.1, 0.1, 0.1), bounceScale: 0.7, fog: new THREE.Color(0.7, 0.6, 0.5), fogDensity: 0.004, clear: new THREE.Color(0.5, 0.5, 0.6) };
  const mix = { mixLength: 0, mixBlock: () => null, mixWeights: new Float64Array(4) };
  const day = { sunDir: new THREE.Vector3(0, 1, 0), moonDir: new THREE.Vector3(0, -1, 0), isDay: true };
  SKY_MOTION.now = small;
  // the small moon held in its totality for the air's run alone (the motion moved once: the run reads its numbers)
  small.at({ count: base[0] });
  const st = new Float64Array(3);
  const walk = (): void => {
    st[0] += 1;
    const wrap = st[0] % 4000 === 0;
    for (let i = 0; i < motions.length; i++) {
      const d = days[i];
      d.count += 0.000005;
      if (wrap) d.count -= 0.02;
      (d as unknown as { fromMotion(m: unknown): void }).fromMotion(motions[i]);
      st[1] += motions[i].sunShare + motions[i].daylight;
    }
  };
  const air = (): void => {
    st[2] += 1;
    // the sun and the night body nudged each frame (the twin sums again), the shade's numbers the eclipse's
    const e = 1.2 + (st[2] % 400) * 0.0005;
    day.sunDir.x = Math.cos(e) * 0.6;
    day.sunDir.y = Math.sin(e);
    day.sunDir.z = Math.cos(e) * 0.8;
    day.moonDir.x = small.nightDir.x;
    day.moonDir.y = small.nightDir.y;
    day.moonDir.z = small.nightDir.z;
    run.heightM = 10.5;
    run.overcast = 0.25;
    run.frame(day, mix, L);
  };
  const walks = (k: number): void => {
    for (let i = 0; i < k; i++) walk();
  };
  const airs = (k: number): void => {
    for (let i = 0; i < k; i++) air();
  };
  try {
    new Function('f', '%NeverOptimizeFunction(f)')(walks);
    new Function('f', '%NeverOptimizeFunction(f)')(airs);
  } catch {
    // without the flag the loops are left to the compiler
  }
  /** The least bytes a frame over clean windows of `n` frames of `go`. */
  const measure = async (go: (k: number) => void, n: number): Promise<number | string> => {
    for (let k = 0; k < 10; k++) {
      go(2000);
      await turn();
    }
    let best = Number.NaN;
    let clean = 0;
    for (let tries = 0; tries < 12 && clean < 3; tries++) {
      go(n / 5);
      gc({ type: 'minor' });
      await turn();
      await turn();
      await turn();
      const c0 = collections;
      const b = young();
      go(n);
      const a = young();
      await turn();
      await turn();
      if (collections === c0) {
        const per = (a - b) / n;
        best = clean === 0 ? per : Math.min(best, per);
        clean++;
      }
    }
    return clean === 0 ? 'no clean window' : best;
  };
  // windows of 60,000: the heap's own read makes some 2.3 KB, 0.04 B a frame over such a window (testing.md)
  const airMade = await measure(airs, 60000);
  const on = await measure(walks, 60000);
  // the same walk with every motion's shade put away (its frame not called): what the motion itself makes
  for (const m of motions) Object.defineProperty(m, 'shade', { value: null });
  const off = await measure(walks, 60000);
  console.log(JSON.stringify({ on, off, air: airMade, sum: Number.isFinite(st[1]) }));
  process.exit(0);
}
