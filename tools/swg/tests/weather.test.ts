// The weather's arithmetic, checked without a browser: the schedule every player shares (the same
// walk for the same moment, never jumping more than a level, spending about as long at each level
// as the planet's climate asks), the wind, the environment rows a level and an area pick, how two
// levels and two areas blend, which effect a forced kind plays, how fast a level eases, Life Day's
// season, which rows keep their shadows, and how wet the ground gets and how it dries.
import assert from 'node:assert/strict';
import {
  CLIMATES,
  FORCED_LEVEL_RATE,
  LEVEL_RATE,
  STEP_SECONDS,
  blockShadow,
  climateFor,
  createMixOut,
  driftScroll,
  effectFor,
  heaviestTwo,
  levelAtStep,
  lifeDayOn,
  mixBlocks,
  rowFor,
  scheduledLevel,
  seedOf,
  seedWet,
  stepLevel,
  stepWet,
  windAt,
  type FamilyRows,
  type WetState,
} from '../../../src/world/weatherSchedule.ts';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ROOF_CELL, ROOF_CELLS, ROOF_GROUPS, ROOF_OPEN, RoofGrid, type RoofSources } from '../../../src/world/roofGrid.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- the schedule ---
const tatooine = [60, 20, 12, 6, 2];
const seed = seedOf('tatooine');
ok(seed === seedOf('tatooine') && seed !== seedOf('naboo'), 'the seed is a function of the pack id alone');
{
  let same = true;
  for (let s = 5_000_000; s < 5_000_200; s++) if (levelAtStep(seed, tatooine, s) !== levelAtStep(seed, tatooine, s)) same = false;
  ok(same, 'levelAtStep is deterministic: the same seed, weights and step give the same level');
}
{
  const N = 100_000;
  const start = 5_900_000;
  const counts = new Array(tatooine.length).fill(0);
  let maxJump = 0;
  let prev = levelAtStep(seed, tatooine, start);
  for (let s = start; s < start + N; s++) {
    const l = levelAtStep(seed, tatooine, s);
    counts[l]++;
    maxJump = Math.max(maxJump, Math.abs(l - prev));
    prev = l;
  }
  ok(maxJump <= 1, `consecutive levels never differ by more than one (largest ${maxJump})`);
  const total = tatooine.reduce((a, b) => a + b, 0);
  const shares = counts.map((c) => c / N);
  const worst = Math.max(...shares.map((f, i) => Math.abs(f - tatooine[i] / total)));
  ok(worst <= 0.04, `each level's share of time is within 0.04 of its weight (${shares.map((f) => f.toFixed(3)).join(' / ')}; worst ${worst.toFixed(3)})`);
}
{
  const w = [60, 25, 15];
  let inRange = true;
  for (let s = 1_000_000; s < 1_020_000; s++) {
    const l = levelAtStep(seedOf('mustafar'), w, s);
    if (l < 0 || l > 2) inRange = false;
  }
  ok(inRange, 'a three-level climate stays in levels 0..2');
}
{
  const naboo = CLIMATES.naboo;
  let checked = 0;
  let good = true;
  for (let t = 1.79e9; t < 1.79e9 + 86400; t += 4321) {
    const s = scheduledLevel(seedOf('naboo'), naboo, t);
    if (s.nextChangeSeconds === null) continue;
    if (!(s.nextChangeSeconds > 0)) good = false;
    const after = scheduledLevel(seedOf('naboo'), naboo, t + s.nextChangeSeconds + 1);
    if (after.level === s.level) good = false;
    checked++;
  }
  ok(good && checked > 10, `nextChangeSeconds is positive and the level one second after it differs (${checked} moments)`);
  const kept = { level: -1, step: -1, nextChangeSeconds: null as number | null };
  const r = scheduledLevel(seedOf('naboo'), naboo, 1.79e9, kept);
  ok(r === kept && kept.step === Math.floor(1.79e9 / STEP_SECONDS), 'scheduledLevel fills a kept record');
}

// --- the wind ---
{
  let worst = 0;
  const w = { heading: 0, gust: 0 };
  let last = windAt(seed, 1.79e9).heading;
  let gustRange = true;
  for (let t = 1.79e9 + 1; t < 1.79e9 + 7200; t += 1) {
    windAt(seed, t, w);
    worst = Math.max(worst, Math.abs(w.heading - last));
    last = w.heading;
    if (w.gust < 0.8 || w.gust > 1.2) gustRange = false;
  }
  ok(worst < 0.05, `the wind's heading changes by less than 0.05 rad in a second (largest ${worst.toFixed(4)})`);
  ok(gustRange, 'gusts stay within 0.8..1.2');
}

// --- climates ---
{
  const k = climateFor('kashyyyk_main', 5);
  ok(k.length === 5 && k.every((v, i) => v === CLIMATES.kashyyyk[i]), 'climateFor("kashyyyk_main", 5) is Kashyyyk\'s climate');
  ok(climateFor('unknown', 3).length === 3, 'an unknown planet gets the default climate cut to its levels');
  const m = climateFor('mustafar', 5);
  ok(m.length === 5 && m[3] === m[2] && m[4] === m[2], 'a short climate is padded with its last weight');
}

// --- rows and the mix ---
const rows = (name: string, byLevel: number[]): FamilyRows => ({ name, byLevel: Int16Array.from(byLevel) });
{
  const r = rows('x', [5, -1, 7, -1, -1]);
  ok(rowFor(r, 1) === 5 && rowFor(r, 4) === 7 && rowFor(r, 0) === 5 && rowFor(r, 2) === 7, 'rowFor takes the level\'s row, else the nearest lower one');
  ok(rowFor(rows('y', [-1, -1, 3]), 0) === 3, 'rowFor falls back to the lowest row there is');
  ok(rowFor(rows('z', [-1, -1]), 1) === -1, 'a family with no rows has none');
}
{
  const out = createMixOut();
  const cur = rows('cur', [0, 1, 2, 3, 4]);
  let n = mixBlocks(out, cur, null, 1, 1.25);
  const pairs = () => Array.from({ length: n }, (_, i) => [out.index[i], out.weight[i]] as const);
  ok(n === 2 && pairs().some(([i, w]) => i === 1 && near(w, 0.75)) && pairs().some(([i, w]) => i === 2 && near(w, 0.25)), 'level 1.25 mixes rows 1 and 2 at 0.75 and 0.25');
  const prev = rows('prev', [10, 11, 12, 13, 14]);
  n = mixBlocks(out, cur, prev, 0.5, 1.25);
  const sum = pairs().reduce((a, [, w]) => a + w, 0);
  ok(n === 4 && near(sum, 1, 1e-5), 'crossing into another area at level 1.25 mixes four rows summing to 1');
  n = mixBlocks(out, cur, null, 1, 2);
  ok(n === 1 && out.index[0] === 2 && near(out.weight[0], 1), 'a whole level is one row');
  n = mixBlocks(out, rows('echo', [6, -1, -1, -1, -1]), null, 1, 3.5);
  ok(n === 1 && out.index[0] === 6 && near(out.weight[0], 1), 'a family with one row at weather 0 draws it at every level');
}

// --- kind substitution ---
{
  const force = {
    rain: ['particles/fx_pt_rain_sheet_verylight.json', 'particles/fx_pt_rain_sheet_light.json', 'particles/fx_pt_rain_sheet_heavy.json'],
    dust: ['particles/fx_pt_dust_storm_light.json', 'particles/fx_pt_dust_storm.json', 'particles/fx_pt_dust_storm_heavy.json'],
    snow: ['particles/fx_pt_snow_lifeday.json', 'particles/fx_pt_snow_storm_heavy.json'],
  };
  const block = { cameraEffect: { file: 'particles/fx_pt_dust_storm.json', kind: 'dust' as const, strength: 0.7 } };
  const rain = [0, 1, 2, 3, 4].map((l) => effectFor(block, 'rain', l, force)?.file ?? null);
  ok(
    rain[0] === null && rain[1]!.includes('verylight') && rain[2]!.endsWith('rain_sheet_light.json') && rain[3]!.includes('heavy') && rain[4]!.includes('heavy'),
    'forced rain at levels 0-4: none, very light, light, heavy, heavy',
  );
  ok(effectFor(block, 'snow', 2, force)?.file.includes('lifeday') === true && effectFor(block, 'snow', 3, force)?.file.includes('storm') === true, 'forced snow: Life Day\'s at 2, the storm at 3');
  const own = effectFor(block, null, 2, force);
  ok(own?.file === block.cameraEffect.file && own.kind === 'dust' && own.strength === 0.7, 'unforced, a block plays its own effect');
  ok(effectFor({ cameraEffect: null }, null, 3, force) === null && effectFor({ cameraEffect: { file: null, kind: 'rain', strength: 1 } }, null, 3, force) === null, 'a block with no effect (or one that failed to convert) plays nothing');
  const kept = { file: '', kind: 'other' as const, strength: 0 };
  ok(effectFor(block, 'dust', 4, force, kept) === kept && kept.kind === 'dust' && kept.strength === 1, 'effectFor fills a kept record');
}

// --- easing a level ---
{
  let l = 0;
  let t = 0;
  let over = false;
  while (l < 4 && t < 60) {
    l = stepLevel(l, 4, 1 / 60, true);
    t += 1 / 60;
    if (l > 4) over = true;
  }
  ok(!over && Math.abs(t - 4 / FORCED_LEVEL_RATE) <= 1 / 60 + 1e-6, `fast, from 0 it reaches 4 after ${t.toFixed(3)} s (12 s) and never overshoots`);
  let s = 0;
  for (let i = 0; i < 600; i++) s = stepLevel(s, 4, 1 / 60, false);
  ok(near(s, 10 * LEVEL_RATE, 1e-6), `slow, it is at ${s.toFixed(4)} after 10 s (0.25)`);
  ok(stepLevel(3, 0, 100, true) === 0 && stepLevel(2, 2, 1, false) === 2, 'it stops at the target going down, and holds at it');
}

// --- Life Day ---
ok(lifeDayOn(-1, 11, 20) && lifeDayOn(-1, 0, 3) && !lifeDayOn(-1, 0, 6) && !lifeDayOn(-1, 5, 1) && !lifeDayOn(0, 11, 20) && lifeDayOn(1, 5, 1), 'Life Day: in season from 15 December to 5 January, always, or never');
ok(lifeDayOn(-1, 11, 15) && !lifeDayOn(-1, 11, 14), 'the season starts on 15 December');

// --- shadows ---
ok(blockShadow(0, false) === 1 && blockShadow(3, false) === 0 && blockShadow(3, true) === 1, 'clear rows always keep shadows; storm rows as the table says');

// --- wetness ---
{
  const s: WetState = { wetness: 0, puddles: 0, snowCover: 0 };
  for (let i = 0; i < 300; i++) stepWet(s, 0.05, 1, 0, 1, 0);
  ok(s.wetness >= 0.6 && s.wetness <= 0.8, `15 s of full rain wets to ${s.wetness.toFixed(3)} (0.6 to 0.8)`);
  for (let i = 0; i < 6000; i++) stepWet(s, 0.05, 0, 0, 1, 0);
  ok(s.wetness < 0.05, `five dry minutes in daylight dry it to ${s.wetness.toFixed(3)}`);
  const snow: WetState = { wetness: 0, puddles: 0, snowCover: 0 };
  for (let i = 0; i < 2000; i++) stepWet(snow, 0.05, 0, 1, 0.5, 0);
  ok(snow.snowCover >= 0.9 && snow.wetness === 0, `100 s of snow covers to ${snow.snowCover.toFixed(3)} and wets nothing`);
  const puddles: WetState = { wetness: 1, puddles: 0, snowCover: 0 };
  for (let i = 0; i < 600; i++) stepWet(puddles, 0.05, 1, 0, 0.5, 0);
  const pud = puddles.puddles;
  for (let i = 0; i < 6400; i++) stepWet(puddles, 0.05, 0, 0, 1, 0);
  ok(pud > 0.5 && puddles.wetness === 0 && puddles.puddles > 0.05, `puddles gather in steady rain (${pud.toFixed(2)}) and outlast the damp (${puddles.puddles.toFixed(2)} left when the ground is dry)`);
  const light: WetState = { wetness: 1, puddles: 0, snowCover: 0 };
  for (let i = 0; i < 20000; i++) stepWet(light, 0.05, 0.35, 0, 1, 0);
  ok(near(light.wetness, 0.35 + 0.65 * 0.35, 1e-3), 'under lighter rain it dries back to what that rain keeps wet, no further');
}
{
  const naboo = CLIMATES.naboo;
  const sd = seedOf('naboo');
  const rainAt = (l: number) => [0, 0, 0.35, 0.6, 1][l] ?? 1;
  let step = 5_960_000;
  while (levelAtStep(sd, naboo, step) !== 4) step++;
  const clock = step * STEP_SECONDS + STEP_SECONDS / 2;
  const s: WetState = { wetness: 0, puddles: 0, snowCover: 0 };
  seedWet(s, sd, naboo, clock, rainAt, () => 0);
  ok(s.wetness >= 0.5, `arriving while it pours finds the ground wet already (${s.wetness.toFixed(3)})`);
  const dry: WetState = { wetness: 1, puddles: 1, snowCover: 1 };
  seedWet(dry, sd, naboo, clock, () => 0, () => 0);
  ok(dry.wetness === 0 && dry.puddles === 0 && dry.snowCover === 0, 'seedWet starts from dry ground');
}

// --- the sky's mix: the two heaviest groups, and the clouds' drift ---
{
  const out = new Int32Array(2);
  heaviestTwo([0.2, 0.5, 0.3], 3, out);
  ok(out[0] === 1 && out[1] === 2, 'heaviestTwo picks the heaviest and the next (1, 2 of 0.2 / 0.5 / 0.3)');
  heaviestTwo([0.9, 0.1, 0.7, 0.8], 4, out);
  ok(out[0] === 0 && out[1] === 3, 'heaviestTwo with the heaviest first still finds the second (0, 3)');
  heaviestTwo([0.4, 0.6], 1, out);
  ok(out[0] === 0 && out[1] === -1, 'one group: the second is none');
  heaviestTwo([], 0, out);
  ok(out[0] === -1 && out[1] === -1, 'no groups: neither');
  heaviestTwo([0.5, 0.5], 2, out);
  ok(out[0] === 0 && out[1] === 1, 'a tie keeps the earlier group first');
}
{
  // A sheet draws the image's texel u at x = repeat * (u - scroll): with repeat 1, a feature moves by
  // minus the change in scroll. It must move toward the heading (0 = +Z, turning toward +X).
  const wrap = (d: number) => d - Math.round(d);
  let good = true;
  let inRange = true;
  for (const h of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 1, 2.5, -2]) {
    const s = { x: 0.5, y: 0.5 };
    driftScroll(s, h, 0.01, 1);
    const mx = -wrap(s.x - 0.5);
    const mz = -wrap(s.y - 0.5);
    const along = mx * Math.sin(h) + mz * Math.cos(h);
    if (!(near(along, 0.01, 1e-9) && near(Math.hypot(mx, mz), 0.01, 1e-9))) good = false;
    for (let i = 0; i < 1000; i++) driftScroll(s, h, 0.37, 0.05);
    if (s.x < 0 || s.x >= 1 || s.y < 0 || s.y >= 1) inRange = false;
  }
  ok(good, 'the clouds drift toward the wind\'s heading, as far as the scroll says, like the rain and the dust');
  ok(inRange, 'the drift stays wrapped to [0, 1)');
}

// --- the roof grid ---
{
  // ROOF_GROUPS is written out so the grid loads without the physics engine: it must still be
  // groups(Group.all, Group.all & ~Group.interior) as core/physics defines them.
  const src = readFileSync(new URL('../../../src/core/physics.ts', import.meta.url), 'utf8');
  const all = Number(/export const Group = \{[^}]*\ball: (0x[0-9a-f]+)/i.exec(src)?.[1]);
  const interior = Number(/export const Group = \{[^}]*\binterior: (0x[0-9a-f]+)/i.exec(src)?.[1]);
  const formula = /export const groups = \(membership: number, filter: number\): number => \(\(membership << 16\) \| filter\) >>> 0;/.test(src);
  ok(formula && all > 0 && interior > 0 && ROOF_GROUPS === (((all << 16) | (all & ~interior)) >>> 0), `ROOF_GROUPS (0x${ROOF_GROUPS.toString(16)}) is every group but the rooms', as core/physics defines them`);
}
{
  const N = ROOF_CELLS;
  const cellOf = (v: number) => Math.floor(v / ROOF_CELL);
  // A stub world: one roof 10 m up over the cell holding (3.2, -5.1), a lake at 2 m over x < -20, ground at 0.
  const roofX = 3.2;
  const roofZ = -5.1;
  let casts = 0;
  let groupsSeen = -1;
  const physics = {
    steps: 0,
    topSurface(x: number, z: number, _fromY: number, _reach: number, g: number): number | null {
      casts++;
      groupsSeen = g;
      return cellOf(x) === cellOf(roofX) && cellOf(z) === cellOf(roofZ) ? 10 : 0;
    },
  };
  const sources: RoofSources = { groundAt: () => 0, waterAt: (x) => (x < -20 ? 2 : -Infinity), include: () => true };
  const grid = new RoofGrid(physics as unknown as ConstructorParameters<typeof RoofGrid>[0]);
  const at = new THREE.Vector3(0, 1.8, 0);
  grid.update(at, N * N, sources);
  ok(casts === 0 && grid.rays === 0 && grid.describe().waitingForStep, 'no ray is cast until physics has stepped since the reset');
  ok(grid.topAt(roofX, roofZ) === 0 && grid.describe().stale === N * N, 'until then every cell is the terrain\'s guess, and stale');
  physics.steps = 1;
  grid.update(at, N * N, sources);
  ok(grid.rays === N * N && groupsSeen === ROOF_GROUPS, 'after a step it casts (queued cells first) with the grid\'s collision groups');
  ok(grid.topAt(roofX, roofZ) === 10, 'a hit at one cell gives topAt that height');
  ok(grid.topAt(roofX + ROOF_CELL, roofZ) === 0 && grid.topAt(roofX, roofZ + ROOF_CELL) === 0 && grid.topAt(roofX - ROOF_CELL, roofZ) === 0, 'the neighbouring cells are open to the ground');
  ok(grid.topAt(-25, 0) === 2 && grid.topAt(-15, 0) === 0, 'a lake\'s surface is the top where it is higher than the ground');
  ok(grid.topAt(1000, 0) === ROOF_OPEN, 'outside the grid nothing is known');
  // The index the shader uses: floor((xz - origin) / cell), row z, column x, over the texture's data.
  const ix = Math.floor((roofX - grid.grid.x) / grid.grid.z);
  const iz = Math.floor((roofZ - grid.grid.y) / grid.grid.z);
  ok(grid.grid.w === N && grid.heights[iz * N + ix] === 10 && (grid.texture.image.data as Float32Array) === grid.heights, 'the shader\'s index (row z, column x) finds the same cell in the texture\'s data');
  // One cell over: the kept heights shift, the roof is found one index over, without a ray.
  casts = 0;
  at.x += ROOF_CELL;
  grid.update(at, 0, sources);
  const ix2 = Math.floor((roofX - grid.grid.x) / grid.grid.z);
  ok(casts === 0 && ix2 === ix - 1 && grid.heights[iz * N + ix2] === 10 && grid.topAt(roofX, roofZ) === 10, 'after a one-cell move the roof is kept, one index over, with no ray cast');
  const col = N - 1;
  let fresh = true;
  for (let z = 0; z < N; z++) if (grid.heights[z * N + col] !== 0) fresh = false;
  ok(fresh && grid.describe().stale === N, 'the column that came into the square is the terrain\'s guess, stale until cast');
  grid.update(at, N, sources);
  ok(grid.describe().stale === 0, 'the cells that came in are cast first');
  // Half the grid or more is a reset: back to waiting for a step.
  casts = 0;
  at.x += (N / 2) * ROOF_CELL;
  grid.update(at, N * N, sources);
  ok(casts === 0 && grid.describe().waitingForStep, 'a move of half the grid resets it, and it waits for the next step');
  physics.steps = 2;
  grid.update(at, 48, sources);
  ok(casts === 48 && grid.rays === 48, 'after that step it casts its budget');
}

console.log(`\n${passed} checks passed`);
