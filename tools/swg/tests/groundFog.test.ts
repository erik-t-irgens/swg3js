// The ground fog's rules (src/world/volumetrics/airFog.ts; the volumetrics' third wave, the design's §2.6 as the owner's
// answer of 2026-10-24 changes it: "the amount of fog and how often it happens should be variable as well, so not every
// morning is foggy"): whether a world's morning and evening are foggy is drawn per world per day from the clock every
// player shares, so two days differ and two players agree; a world with no row never fogs (Tatooine, Lok, Mustafar, a
// space zone, the world of copies, a real-elevation world, anything unlisted); over a year Rori and Naboo are foggy more
// often than Corellia and Talus; the level by the hour (first light, three hours on, noon, dusk) for every planet in the
// table; the burn-off's decay rising as it thins and the top rising with it; the top never one number; and in a 2D
// mirror of the field's fog channel, undisturbed fog pools in a hollow, a bank is carried downwind by at least a third of
// the wind's run, and with every emission at nought nothing appears (no relaxation hides in it). And the hand-overs only
// the game makes: the day from the shared clock, the console's fog morning.
//
// Plain type stripping; synthetic numbers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FogDayCount, fogDayOf, FOG_HOURS, fogHash, fogHourIn, fogPatch, fogProfile, fogStepGrid, fogTopAt, newFogGrid, newFogHour, type FogDay } from '../../../src/world/volumetrics/airFog.ts';
import { AIR_TUNE, GROUND_FOG_LOOKS, tuneFogLooks } from '../../../src/world/volumetrics/airTune.ts';
import { PLANETS } from '../../../src/data/planets.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string): string => readFileSync(join(here, '..', '..', '..', 'src', p), 'utf8').replace(/\r\n/g, '\n');
const day = (): FogDay => ({ morning: 0, evening: 0, eveningBefore: 0 });

// --- the day's draw: a hash, never a roll ---
{
  const a = fogDayOf('naboo', 1234, day());
  const b = fogDayOf('naboo', 1234, day());
  ok(a.morning === b.morning && a.evening === b.evening && a.eveningBefore === b.eveningBefore, 'the same world and day draw the same fog in every browser (a hash of the two, nothing rolled)');
  let differ = 0;
  for (let d = 0; d < 60; d++) {
    const x = fogDayOf('naboo', d, day());
    const y = fogDayOf('naboo', d + 1, day());
    if (x.morning !== y.morning) differ++;
  }
  ok(differ > 10, `two days differ: ${differ} of 60 neighbouring mornings on Naboo drawn differently`);
  ok(fogDayOf('naboo', 77, day()).eveningBefore === fogDayOf('naboo', 76, day()).evening, "the night carries the evening before into the morning: a day's eveningBefore is yesterday's evening");
  ok(fogHash('naboo', 1, 1) !== fogHash('rori', 1, 1) && fogHash('naboo', 1, 1) !== fogHash('naboo', 2, 1), 'the hash moves with the world and the day');
}

// --- a world with no row never fogs ---
{
  const never = ['tatooine', 'lok', 'mustafar', 'dungeon1', 'space_tatooine', 'space_naboo', 'monument', 'helensar', 'not_a_world', ''];
  let fogs = 0;
  for (const w of never) for (let d = 0; d < 365; d++) {
    const x = fogDayOf(w, d, day());
    if (x.morning > 0 || x.evening > 0 || x.eveningBefore > 0) fogs++;
  }
  ok(fogs === 0, `Tatooine, Lok, Mustafar, the world of copies, a space zone, a real-elevation world and anything unlisted never fog over a year`);
  for (const p of PLANETS as readonly { id: string; space?: unknown; dem?: unknown; instances?: unknown }[]) {
    if (p.space || p.dem || p.instances) ok(!(p.id in GROUND_FOG_LOOKS), `${p.id}: no fog row (space, real elevation or copies)`);
  }
  ok(!('tatooine' in GROUND_FOG_LOOKS) && !('lok' in GROUND_FOG_LOOKS) && !('mustafar' in GROUND_FOG_LOOKS), "the dry worlds have no row");
}

// --- a year's shares: Rori and Naboo foggier than Corellia and Talus ---
{
  const share = (w: string): number => {
    let n = 0;
    for (let d = 0; d < 365; d++) if (fogDayOf(w, d, day()).morning > 0) n++;
    return n / 365;
  };
  const s = Object.fromEntries(['rori', 'naboo', 'corellia', 'talus', 'dantooine', 'yavin4', 'endor'].map((w) => [w, share(w)]));
  ok(s.rori > s.corellia && s.rori > s.talus && s.naboo > s.corellia && s.naboo > s.talus, `over a year Rori (${(s.rori * 100).toFixed(0)}%) and Naboo (${(s.naboo * 100).toFixed(0)}%) have foggy mornings more often than Corellia (${(s.corellia * 100).toFixed(0)}%) and Talus (${(s.talus * 100).toFixed(0)}%)`);
  // Each world's year comes out at its own row's chance (the dial, whatever the owner sets it to): a year of 365 draws
  // lies within about a tenth of it, which is four of a binomial's spreads.
  const off = Object.keys(s).map((w) => Math.abs(s[w] - GROUND_FOG_LOOKS[w].morning));
  ok(off.every((d) => d < 0.1), `each world's foggy mornings over a year are its row's own chance (worst ${Math.max(...off).toFixed(3)} off): the draw is the dial`);
  ok(s.yavin4 > s.dantooine && s.endor > s.dantooine, `the jungles and forests often (${(s.yavin4 * 100).toFixed(0)}%, ${(s.endor * 100).toFixed(0)}%), Dantooine sometimes (${(s.dantooine * 100).toFixed(0)}%)`);
  let thick = new Set<number>();
  for (let d = 0; d < 365; d++) {
    const m = fogDayOf('naboo', d, day()).morning;
    if (m > 0) thick.add(Math.round(m * 100));
  }
  ok(thick.size > 10, `and not every foggy morning is as thick: ${thick.size} different thicknesses on Naboo`);
  thick = new Set();
}

// --- the level by the hour, for every planet in the table ---
for (const [w, look] of Object.entries(GROUND_FOG_LOOKS)) {
  const h = newFogHour();
  h.morning = (look.morningLo + look.morningHi) / 2;
  h.evening = (look.eveningLo + look.eveningHi) / 2;
  h.eveningBefore = h.evening;
  h.lookTop = look.top;
  const at = (t: number): { level: number; burn: number; top: number } => {
    h.time = t;
    fogHourIn(h);
    return { level: h.level, burn: h.burn, top: h.top };
  };
  const dawn = at(FOG_HOURS.dawn);
  const later = at(FOG_HOURS.dawn + 1 / 8);
  const noon = at(0.5);
  const dusk = at(FOG_HOURS.dusk);
  ok(near(dawn.level, h.morning) && later.level === 0 && noon.level === 0 && near(dusk.level, h.evening), `${w}: the morning's fog at first light (${h.morning.toFixed(2)}), gone three hours on and at noon, the evening's at dusk (${h.evening.toFixed(2)})`);
}
{
  const h = newFogHour();
  h.morning = 0.8;
  h.evening = 0.2;
  h.eveningBefore = 0.2;
  h.lookTop = 4;
  let lastBurn = -1;
  let lastTop = -1;
  let rising = true;
  for (let t = FOG_HOURS.dawn; t < FOG_HOURS.morningEnds; t += 0.005) {
    h.time = t;
    fogHourIn(h);
    if (h.burn < lastBurn - 1e-12 || h.top < lastTop - 1e-12) rising = false;
    lastBurn = h.burn;
    lastTop = h.top;
  }
  ok(rising && lastBurn > 0.9 && lastTop > 4, `as the morning's fog thins its burn rises to ${lastBurn.toFixed(2)} and its top lifts to ${lastTop.toFixed(1)} m (from the look's 4)`);
  const dec = (burn: number): number => Math.exp(-(AIR_TUNE.fog.decay + AIR_TUNE.fog.burn * burn));
  ok(dec(1) < dec(0), "and the burn raises the decay: the fog burns off");
  ok(fogProfile(0, 5) === 1 && fogProfile(0.5 * 5, 5) === 1 && fogProfile(5, 5) === 0 && fogProfile(4, 5) > 0 && fogProfile(4, 5) < 1, 'full to 55% of its top and gone at it');
  const tops = [0, 0.2, 0.5, 0.8, 1].map((n) => fogTopAt(5, n));
  ok(tops[0] === 5 * AIR_TUNE.fog.topLow && near(tops[4], 5 * (1 + AIR_TUNE.fog.topRise)) && tops.every((t, i) => i === 0 || t > tops[i - 1]), `the top is never one number: ${tops.map((t) => t.toFixed(1)).join(', ')} m over the noise`);
  ok(fogPatch(AIR_TUNE.fog.gaps * 0.9) === 0 && fogPatch(1) === 1, 'the ground gives off fog in patches with gaps between them: nothing under the gaps\' share of the noise');
}

// --- the 2D mirror: pooling, carried on the wind, nothing imposed ---
{
  // A valley across x: a flat floor about the middle, rising either side past the drainage's least lean.
  const n = 64;
  const g = newFogGrid(n, 2);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g.ground[j * n + i] = 0.004 * (i - n / 2) * (i - n / 2) * 4;
  g.level = 1;
  for (let s = 0; s < 60 * 20; s++) fogStepGrid(g, 1 / 20);
  let floor = 0;
  let rise = 0;
  let nf = 0;
  let nr = 0;
  for (let j = 8; j < n - 8; j++) {
    for (let i = 0; i < n; i++) {
      const d = Math.abs(i - n / 2);
      if (d <= 2) {
        floor += g.fog[j * n + i];
        nf++;
      } else if (d >= 14 && d <= 22) {
        rise += g.fog[j * n + i];
        nr++;
      }
    }
  }
  floor /= nf;
  rise /= nr;
  ok(floor > rise * 1.5, `undisturbed, with no wind, fog pools in the hollow: ${floor.toFixed(3)} over the valley floor against ${rise.toFixed(3)} on the rise after 60 s`);
  for (let s = 0; s < 600 * 20; s++) fogStepGrid(g, 1 / 20);
  let most = 0;
  for (const v of g.fog) most = Math.max(most, v);
  ok(most <= AIR_TUNE.fog.poolMost + AIR_TUNE.fog.emit / AIR_TUNE.fog.decay + 1e-6, `and however long the morning, the drainage piles it no thicker than poolMost (${most.toFixed(2)} after ten minutes, the most ${AIR_TUNE.fog.poolMost} and what the ground gives off besides): a thick pool, never a wall`);
  // A bank on flat ground, the wind on, nothing emitted: carried downwind.
  const b = newFogGrid(n, 2);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const dx = i - 20;
    const dz = j - n / 2;
    b.fog[j * n + i] = dx * dx + dz * dz < 36 ? 1 : 0;
  }
  const middle = (f: Float64Array): number => {
    let m = 0;
    let mx = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      m += f[j * n + i];
      mx += f[j * n + i] * i;
    }
    return (mx / m) * 2;
  };
  const before = middle(b.fog);
  b.windX = 1;
  for (let s = 0; s < 30 * 20; s++) fogStepGrid(b, 1 / 20);
  const moved = middle(b.fog) - before;
  ok(moved >= 30 / 3, `with the wind on a bank's density-weighted middle moves downwind ${moved.toFixed(1)} m in 30 s at 1 m/s: carried, not imposed (at least a third of the wind's run)`);
  // Every emission number at nought: nothing appears, anywhere, ever.
  const z = newFogGrid(n, 2);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z.ground[j * n + i] = g.ground[j * n + i];
  z.level = 0;
  z.windX = 0.7;
  for (let s = 0; s < 60 * 20; s++) fogStepGrid(z, 1 / 20);
  ok(z.fog.every((v) => v === 0), 'with every emission at nought nothing appears: no relaxation toward a level hides in it');
  const shader = src('world/volumetrics/airShaders.ts');
  ok(shader.includes('float pressed = fog * exp(-fogDiv * uDt);') && shader.includes('fog = fogDiv < 0.0 ? min(pressed, max(fog, uFogS.x)) : pressed;') && shader.includes('fog *= uFogDecay;') && shader.includes('fog += uFogEmit * fogPatchAt(uWindow.xy + l * uWindow.z) * (water ? uFogQ.y : 1.0) * uDt;') && shader.includes('if (outsideOf(bf)) fog = uFogBank * fogPatchAt(uWindow.xy + bf * uWindow.z);') && !/mix\(fog, [^)]*level/.test(shader), "the field's fog channel is the mirror's lines: carried, decayed and compressed by the drainage, emitted in patches, the bank on the wind, never mixed toward a level");
  ok(shader.includes('vec2 bf = l - (v0 + drain) * k + uSmokeShift;') && shader.includes('drain = -g / lean * uFogDrain;') && shader.includes('fogDiv = -uFogDrain * (hxx + hzz) / lean;') && shader.includes('fogDiv = -uFogDrain * (hxx * g.y * g.y - 2.0 * hxz * g.x * g.y + hzz * g.x * g.x) / (s * s * s);'), "and drained down the fall line, in proportion under the least lean and at full speed past it, its divergence fogDrainAt's");
}

// --- the hand-overs only the game makes ---
{
  const world = src('world/world.ts');
  ok(world.includes('count.time = day.time;\n    sharedClock.dayCountIn(day, count);\n    count.step();\n    const idx = count.day;'), "the day's number is the drawn day counted against the shared clock (`FogDayCount`), never the wall less the drawn time");
  ok(world.includes('fh.morning = hold.day ? (look ? look.morningHi : 0.8) : this.fogDay.morning;') && world.includes('inp.fogLevel = hold.level !== null ? hold.level : look || hold.day ? fh.level : 0;'), "a world with no row gives the field no fog; the console's fog morning forces the day's draw");
  const main = src('main.ts');
  ok(main.includes('if (o.fog.day !== undefined) h.day = o.fog.day === true;') && main.includes('fogHour: this.world.fogReport(),'), '`__debug.air({ fog: { day: true } })` forces a fog morning, and the answer says the day\'s draw');
  // The day's number steps at the drawn midnight and nowhere else, whatever the drawn time does against the wall clock.
  // A run of frames: the wall advancing by its own seconds, the drawn time by its own step (the DayCycle's: clamped to a
  // twentieth, times ninety with the fast-forward key), each frame handed to a real FogDayCount.
  const len = 720;
  const phase = 0.3;
  interface Run {
    steps: number;
    wrongAt: number;
    days: number[];
  }
  /**
   * `frames` frames of `frameSec` wall seconds (or `wallStep`'s), the drawn time stepped by `drawnStep`; `shared` hands
   * the shared day.
   */
  const runDays = (frames: number, frameSec: number, drawnStep: (f: number, sec: number) => number, shared: ((wall: number) => number) | null, t0 = 0.4, wallStep: (f: number, sec: number) => number = (_f, sec) => sec): Run => {
    const c = new FogDayCount();
    let wall = 1_000_000;
    let drawn = t0;
    let steps = 0;
    let wrongAt = -1;
    let last = Number.NaN;
    const days: number[] = [];
    for (let f = 0; f < frames; f++) {
      const before = drawn;
      drawn = (drawn + drawnStep(f, frameSec)) % 1;
      if (drawn < 0) drawn += 1;
      wall += wallStep(f, frameSec);
      c.time = drawn;
      c.wall = wall / len + phase;
      c.shared = shared ? shared(wall) : Number.NaN;
      c.step();
      if (f > 0 && c.day !== last) {
        steps++;
        // A step is right only on the frame the drawn time wrapped (forward a day) or wound back over midnight.
        const wrapped = drawn < before - 0.5 ? 1 : drawn > before + 0.5 ? -1 : 0;
        if (c.day - last !== wrapped && wrongAt < 0 && !shared) wrongAt = f;
      }
      last = c.day;
      days.push(c.day);
    }
    return { steps, wrongAt, days };
  };
  // With no server: the drawn time at the wall's pace, at half of it (10 frames a second, each step clamped to a
  // twentieth), ninety times over (the fast-forward key), and coming back from a tab hidden six minutes.
  const even = runDays(Math.round((len * 3) / 0.05), 0.05, (_f, sec) => sec / len, null);
  ok(even.steps === 3 && even.wrongAt < 0, `with no server and the drawn time at the wall's pace the day's number steps three times in three days (${even.steps}), each at the drawn midnight`);
  const slow = runDays(Math.round((len * 3) / 0.1), 0.1, () => 0.05 / len, null);
  ok(slow.steps === 1 && slow.wrongAt < 0, `at 10 frames a second (each step clamped to a twentieth, the drawn day at half the wall's pace) it steps once in the drawn day and a half (${slow.steps}), at the drawn midnight, never mid-morning`);
  const fast = runDays(2000, 1 / 60, (f, sec) => (f < 1500 ? (sec / len) * 90 : sec / len), null);
  ok(fast.wrongAt < 0 && fast.steps === Math.floor(0.4 + (1500 * 90) / 60 / len + (500 / 60) / len), `with the fast-forward key the drawn days run ninety times over and it steps at each drawn midnight (${fast.steps} times), never by the wall`);
  // Six minutes hidden is half a day of wall clock in one frame, which carries one clamped step of drawn time: worked out
  // as the wall less the drawn time, the day moved by half a day there.
  const hidden = runDays(200, 1 / 60, (f, sec) => (f === 100 ? 0.05 / len : sec / len), null, 0.4, (f, sec) => (f === 100 ? 360 : sec));
  ok(hidden.steps === 0, 'a frame that comes back after six minutes hidden carries one clamped step of drawn time, and the day holds');
  // With a server: two browsers whose drawn times stand a little either side of the shared hour as each eases, and an
  // anchor whose fraction sits on the half (`dayFrom` arbitrary), name the same day on every frame and step at midnight.
  const anchored = (wall: number): number => 0.4999 + (wall - 1_000_000) / len;
  const a = runDays(Math.round((len * 2) / 0.05), 0.05, (_f, sec) => sec / len, anchored, 0.4999 - 0.006);
  const b = runDays(Math.round((len * 2) / 0.05), 0.05, (_f, sec) => sec / len, anchored, 0.4999 + 0.007);
  let agree = 0;
  for (let i = 0; i < a.days.length; i++) {
    // Each eases toward the shared hour; compared while both stand on the same side of a midnight, the frames a lag or a
    // lead puts across the line excepted (a hundredth of a day at most: the drawn times are 0.013 apart).
    const tA = (0.4999 - 0.006 + (i + 1) * (0.05 / len)) % 1;
    const tB = (0.4999 + 0.007 + (i + 1) * (0.05 / len)) % 1;
    if (Math.floor(tA - 0.0001) === Math.floor(tB - 0.0001) && Math.abs(tA - tB) < 0.5) agree += a.days[i] === b.days[i] ? 1 : 0;
    else agree++;
  }
  ok(agree === a.days.length && a.steps === 2 && b.steps === 2, `with a server two browsers a little either side of the shared hour, an anchor's fraction on the half, name the same day on every frame (${agree} of ${a.days.length}) and step twice in two days`);
  const held = new FogDayCount();
  held.time = 0.2;
  held.wall = 0.5;
  held.shared = 1000.2;
  held.step();
  const firstDay = held.day;
  for (let i = 1; i <= 700; i++) {
    // The drawn time held at 0.2 by hand while the shared day runs on to 0.9 of it: past half a day the shared moment is
    // nearer the next drawn 0.2, and the day must stay the day it was.
    held.shared = 1000.2 + i / 1000;
    held.step();
  }
  const heldDay = held.day;
  // Let go, the drawn time put straight onto the shared hour (0.9): a jump back over no midnight, which the wrap count
  // reads as a wind back a day, and the count is taken back to the shared day.
  held.time = 0.9;
  held.step();
  ok(firstDay === 1000 && heldDay === 1000 && held.day === 1000, `the drawn time held by hand keeps its day while the shared clock runs on (${heldDay}), and is taken back to the shared day once the two agree again (${held.day})`);
  const notes = tuneFogLooks({ naboo: { morning: 2 }, tatooine: { morning: 1 } });
  ok(GROUND_FOG_LOOKS.naboo.morning === 1 && notes.some((s) => s.includes('tatooine')), 'a look is moved live and held to its range; a world with no row is refused in words');
  tuneFogLooks({ naboo: { morning: 0.75 } });
}

console.log(`\n${checks} checks passed`);
