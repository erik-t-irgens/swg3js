// What floats: the rule the second water reader runs on.
//
// The wave arithmetic itself is `src/world/swellMath.ts` and is pinned against the shader's own text
// by `swell.test.ts`; nothing of it is repeated here or in `seaFeed.ts`. What this pins is the half
// that is **ours** -- whether the swell reaches the springs at all, how much of it does, which of
// the sum's two answers is taken, and how the answer is put back together with the flat table --
// and, above all, that every way of saying no answers the flat height **to the bit**, since a lake,
// a pool, the shallows and a planet with no sea must behave after this package exactly as they did
// before it.
//
// One line of the shader is read here as well, and only one: that its fade is a product of the
// material's wave height, a camera-distance term and a depth term. The whole of `farFade` rests on
// it -- leaving the far term out is done by handing the distance a 0, where that term is 1 -- so
// this package's own story fails here rather than in the water if the shader is ever rewritten.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEA_FEED, seaFeedReport, seaHeight, seaSwellAt, swellScaleAt, tuneSeaFeed, type SwellWave } from '../../../src/world/seaFeed.ts';
import { SWELL_FADE, SWELL_GRAVITY, swellHeight, swellHeightSolved } from '../../../src/world/swellMath.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const close = (a: number, b: number, msg: string, eps = 1e-9) => ok(Math.abs(a - b) <= eps, `${msg} (${a} ~ ${b})`);

/** Put every knob back where the module declares it, so no check can be read through another's tuning. */
const DEFAULTS = { ...SEA_FEED };
const reset = () => Object.assign(SEA_FEED, DEFAULTS);

/**
 * The game's own sea state, rebuilt here by the very arithmetic `seaState` runs in `water.ts` at the
 * seed and wind angle `createWaterMaterial` defaults to (7 and 0.9 rad), which is what the near sea
 * is really made with. It is a **fixture**, not a pin: change the seed or the amplitudes and the
 * numbers in the messages below move while every check still holds.
 */
function seaState(seed: number, windAngle: number): { waves: SwellWave[]; omega: number[] } {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const waves: SwellWave[] = [];
  const omega: number[] = [];
  for (let i = 0; i < 8; i++) {
    const t = (i + rnd() * 0.8) / 8;
    const wavelength = 7.5 * Math.pow(38 / 7.5, t);
    const spread = lerp(1.1, 0.3, t);
    const angle = windAngle + (rnd() - 0.5) * 2 * spread;
    const k = (2 * Math.PI) / wavelength;
    const amplitude = wavelength * lerp(0.005, 0.0095, t) * (0.7 + rnd() * 0.6);
    waves.push({ x: Math.cos(angle), y: Math.sin(angle), z: k, w: amplitude });
    omega.push(Math.sqrt(SWELL_GRAVITY * k));
  }
  return { waves, omega };
}
const SEA = seaState(7, 0.9);
const REACH = SEA.waves.reduce((a, w) => a + w.w, 0);

// --- the one line of the shader this package's own story rests on ---------------------------------

const waterSrc = readFileSync(new URL('../../../src/world/water.ts', import.meta.url), 'utf8');
const fade = waterSrc.match(/float fade = uWaveHeight \* \(1\.0 - smoothstep\(([\d.]+), ([\d.]+), dist\)\) \* smoothstep\(([\d.]+), ([\d.]+), waterDepth\(wp\.xz\)\);/);
ok(!!fade, 'the shader still fades the swell as a product of the wave height, a camera-distance term and a depth term');
ok(Number(fade![1]) === SWELL_FADE.farNear && Number(fade![2]) === SWELL_FADE.farFar && Number(fade![3]) === SWELL_FADE.shallowNear && Number(fade![4]) === SWELL_FADE.shallowFar, 'and the four edges this rule leans on are the shader\'s own, carried by swellMath (whose test owns the pin)');
close(swellScaleAt(50, 1, 0), 1, 'a distance of 0 is what takes the far term out: it is 1 there, so the whole swell survives');

// --- a lake, a pool, and anything with no swell ----------------------------------------------------

reset();
close(swellScaleAt(50, 0, 0), 0, 'a mesh with no swell at all (uWaveHeight 0: every lake, the far ring) is asked for none of it');
for (const flat of [-Infinity, 0, 12, 75.25, -300]) {
  assert.equal(seaHeight(flat, 0), flat, `no swell at flat=${flat}`);
  assert.equal(seaHeight(flat, seaSwellAt(SEA.waves, SEA.omega, 40, -90, 3.5, swellScaleAt(50, 0, 0))), flat, `a lake at flat=${flat}`);
}
ok(true, 'so over five surfaces a lake answers the flat height to the bit, sum or no sum');
ok(seaHeight(-Infinity, 0.87) === -Infinity, 'a dry column stays dry: no swell is added to no water');

// --- the shallows ------------------------------------------------------------------------------------

reset();
close(swellScaleAt(SWELL_FADE.shallowNear, 1, 0), 0, 'at the shader\'s own shallow edge the swell is dead, so the shoreline holds still');
close(swellScaleAt(0, 1, 0), 0, 'and in no water at all');
close(swellScaleAt(-3, 1, 0), 0, 'and where the ground stands above the surface (a negative depth)');
close(swellScaleAt(SWELL_FADE.shallowFar, 1, 0), 1, 'at the deep edge, the whole of it');
close(swellScaleAt(Infinity, 1, 0), 1, 'water of unknown depth takes the whole of it, as the shader\'s own unfilled cells do');
close(swellScaleAt(Number.NaN, 1, 0), 0, 'a depth that is not a number takes none of it rather than a guess');
close(swellScaleAt((SWELL_FADE.shallowNear + SWELL_FADE.shallowFar) / 2, 1, 0), 0.5, 'and halfway between the edges, half');
// No step anywhere in the band: a hull crossing the shelf must not be kicked.
let worst = 0;
let previous = 0;
for (let i = 0; i <= 600; i++) {
  const s = swellScaleAt(i * 0.01, 1, 0);
  worst = Math.max(worst, Math.abs(s - previous));
  previous = s;
}
ok(worst <= 0.0056, `the scale moves by at most ${worst.toFixed(4)} over a centimetre of depth: no step where the shelf is crossed`);
for (let i = -100; i <= 1000; i++) assert.ok(swellScaleAt(i * 0.05, 1, 0) >= 0 && swellScaleAt(i * 0.05, 1, 0) <= 1, `scale in range at depth ${(i * 0.05).toFixed(2)}`);
ok(true, 'over 1,101 depths from 5 m of ground to 50 m of water the scale stays between 0 and 1');
// And the height that comes of it is inside the swell's own reach, wherever it is asked.
let biggest = 0;
for (let i = 0; i < 2000; i++) biggest = Math.max(biggest, Math.abs(seaSwellAt(SEA.waves, SEA.omega, i * 3.7, i * -1.9, i * 0.05, 1)));
ok(biggest <= REACH + 1e-9, `over 2,000 points and clocks the swell never passed its own reach (${biggest.toFixed(3)} m of ${REACH.toFixed(3)} m)`);

// --- the camera-distance fade, which is off ------------------------------------------------------------

reset();
close(swellScaleAt(50, 1, 5000), 1, 'by default a hull five kilometres from the camera bobs exactly as one under its nose does: physics must not change when you look away');
tuneSeaFeed({ farFade: true });
close(swellScaleAt(50, 1, SWELL_FADE.farNear), 1, 'with the far fade on, a hull at the shader\'s near edge still takes the whole swell');
close(swellScaleAt(50, 1, SWELL_FADE.farFar), 0, 'and at its far edge none, which is what the mesh out there really draws');
close(swellScaleAt(50, 1, Number.NaN), 1, 'a distance that is not a number is not a reason to flatten a hull');
reset();

// --- the switch and the scale ----------------------------------------------------------------------

reset();
tuneSeaFeed({ on: false });
close(swellScaleAt(50, 1, 0), 0, 'the switch off: no scale at all');
close(seaHeight(12, 1.19), 12, 'and the flat table even if a caller hands a swell in anyway');
reset();
tuneSeaFeed({ scale: 0.5 });
close(swellScaleAt(50, 1, 0), 0.5, 'half the scale, half the swell');
close(seaHeight(12, seaSwellAt(SEA.waves, SEA.omega, 0, 0, 0, 1)) - 12, seaSwellAt(SEA.waves, SEA.omega, 0, 0, 0, 1), 'and the height is the flat table plus exactly what the sum said');
tuneSeaFeed({ scale: 0 });
close(swellScaleAt(50, 1, 0), 0, 'a scale of nothing is a flat sea');
tuneSeaFeed({ scale: -2 });
close(swellScaleAt(50, 1, 0), 0, 'and so is a scale below nothing, rather than a sea upside down');
reset();
tuneSeaFeed({ scale: Number.NaN, solve: Number.POSITIVE_INFINITY, on: 'yes' as unknown as boolean });
ok(SEA_FEED.scale === DEFAULTS.scale && SEA_FEED.solve === DEFAULTS.solve && SEA_FEED.on === DEFAULTS.on, 'a knob written with something that is not a finite number (or a boolean where one goes) is ignored, not stored');
tuneSeaFeed({ solve: 99 });
ok(SEA_FEED.solve === 16, 'and a solve past the sum\'s own ceiling is held at it rather than spending passes for nothing');
tuneSeaFeed({ solve: -1 });
ok(SEA_FEED.solve === 0, 'a solve below nothing is no solve');
reset();

// --- which of the sum's two answers is taken ---------------------------------------------------------

reset();
ok(SEA_FEED.solve === 1, 'one step of the inverse solve by default');
const at = (x: number, z: number, t: number) => seaSwellAt(SEA.waves, SEA.omega, x, z, t, 1);
tuneSeaFeed({ solve: 0 });
const forward = at(31.4, -12.2, 4.75);
tuneSeaFeed({ solve: 1 });
const one = at(31.4, -12.2, 4.75);
tuneSeaFeed({ solve: 8 });
const converged = at(31.4, -12.2, 4.75);
close(forward, swellHeight(SEA.waves, SEA.omega, 31.4, -12.2, 4.75, 1), 'solve 0 is the plain forward sum, unchanged');
close(one, swellHeightSolved(SEA.waves, SEA.omega, 31.4, -12.2, 4.75, 1, 1), 'solve 1 is one step of the inverse');
ok(Math.abs(one - converged) < Math.abs(forward - converged), `and one step is nearer the converged answer than none (${Math.abs(one - converged).toFixed(5)} m against ${Math.abs(forward - converged).toFixed(5)} m)`);
// What the solve is really worth over the game's own sea, which is what says whether the default earns its pass.
let sumF = 0;
let sumO = 0;
let worstF = 0;
let n = 0;
for (let i = 0; i < 4000; i++) {
  const x = (i % 97) * 2.13;
  const z = ((i * 7) % 89) * -1.71;
  const t = i * 0.017;
  tuneSeaFeed({ solve: 8 });
  const c = at(x, z, t);
  tuneSeaFeed({ solve: 0 });
  const f = at(x, z, t);
  tuneSeaFeed({ solve: 1 });
  const o = at(x, z, t);
  sumF += (f - c) * (f - c);
  sumO += (o - c) * (o - c);
  worstF = Math.max(worstF, Math.abs(f - c));
  n++;
}
ok(Math.sqrt(sumO / n) < Math.sqrt(sumF / n) / 5, `over 4,000 points: no solve is ${Math.sqrt(sumF / n).toFixed(4)} m r.m.s. out and ${worstF.toFixed(3)} m at worst, one step ${Math.sqrt(sumO / n).toFixed(5)} m -- which is why one step is the default`);
reset();

// --- the height itself, and what never leaves here ------------------------------------------------------

reset();
close(seaHeight(12, 0.8), 12.8, 'the flat table plus the wave height');
close(seaHeight(12, -0.8), 11.2, 'a trough takes the surface down as far as a crest takes it up');
close(seaHeight(12, Number.NaN), 12, 'a sum that is not a number leaves the flat table alone');
close(seaHeight(12, Infinity), 12, 'and so does one that is not finite');
close(seaSwellAt(SEA.waves, SEA.omega, Number.NaN, 0, 0, 1), 0, 'a point that is not a number is no swell, not a NaN handed to a spring');
close(seaSwellAt([], [], 0, 0, 0, 1), 0, 'and an empty wave set is a flat sea');
for (let i = 0; i < 500; i++) {
  const h = seaHeight(12, seaSwellAt(SEA.waves, SEA.omega, i * 0.7, i * -0.3, i * 0.02, swellScaleAt(i * 0.02, 1, 0)));
  assert.ok(Number.isFinite(h), `a real number at step ${i}`);
}
ok(true, 'over 500 points crossing a shelf, what a spring is handed is always a real number: one NaN in a pose is a hull thrown out of the world');

// --- the rhythm, and what a hull will really feel ---------------------------------------------------------

reset();
let lo = Infinity;
let hi = -Infinity;
let fastest = 0;
let last = at(0, 0, 0);
for (let i = 1; i <= 60 * 240; i++) {
  const h = at(0, 0, i / 240);
  lo = Math.min(lo, h);
  hi = Math.max(hi, h);
  fastest = Math.max(fastest, Math.abs(h - last) * 240);
  last = h;
}
ok(hi - lo > 1.5 && hi - lo < 2 * REACH, `at one point over a minute the surface moved ${(hi - lo).toFixed(2)} m, inside the ${(2 * REACH).toFixed(2)} m the eight amplitudes could ever reach together`);
ok(fastest > 1 && fastest < 4, `and rose or fell at up to ${fastest.toFixed(2)} m/s, which is what a hull's springs have to answer`);
// A four-cornered hull the size of a speeder: the difference between its corners is its pitch and roll.
let tilt = 0;
for (let i = 0; i < 4000; i++) {
  const t = i / 40;
  const c = [at(1.5, 0.7, t), at(-1.5, 0.7, t), at(1.5, -0.7, t), at(-1.5, -0.7, t)];
  tilt = Math.max(tilt, Math.max(...c) - Math.min(...c));
}
ok(tilt > 0.3, `a 3 m by 1.4 m hull's corners stand up to ${tilt.toFixed(2)} m apart, so the springs are given a real pitch and roll and not just a lift`);

// --- the hull's own height, and the two rules that measure it ---------------------------------------------

// Feeding the springs the sea makes a hull's **own height** breathe, so every rule that compares
// that height against a water surface must read the same surface or the margin it was given is
// eaten by the wave. Two do: `Vehicle.onWater`, which drives the wake field, the water engine loop
// and whether dust is raised, and the wake's own depth window. Both are pinned here as text, the
// way this package's one shader line is, because what they would come back as is silent -- a
// verdict that flickers on the open sea and nowhere else, and only while a crest is under the hull.
reset();
const vehicleSrc = readFileSync(new URL('../../../src/vehicles/vehicle.ts', import.meta.url), 'utf8');
const worldSrc = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
ok(
  /const bedY = ground\(this\.pos\.x, this\.pos\.z\);\s*\n\s*const flatTop = water\(this\.pos\.x, this\.pos\.z\);\s*\n\s*if \(flatTop > bedY \+ 0\.05\) \{/.test(vehicleSrc),
  'whether the column under a hull is wet at all is still the flat table against the ground: that is a verdict, and a verdict keeps the steady reader',
);
ok(
  /const top = sea \? sea\(this\.pos\.x, this\.pos\.z, bedY\) : flatTop;\s*\n\s*this\.onWater = this\.pos\.y - s\.bounds\.min\[1\] < top \+ ride \* 1\.6 \+ 0\.3;/.test(vehicleSrc),
  'but how high the hull stands over it is measured against the sea the springs float it on, never the plane through the middle of it',
);
ok(
  /const lift = floats \? this\.seaSwellOver\(p\.x, p\.z\) : 0;\s*\n\s*const depth = surface \+ lift - p\.y;/.test(worldSrc),
  'and the wake\'s depth window adds the swell back over a floating hull, so the depth is what it was on a flat sea',
);
ok(
  /touch\(v, tmpV, geo, Math\.max\(0\.5, v\.radius \* 0\.7\), tmpQ, 1\.4 \+ v\.radius \* 0\.3, true\);/.test(worldSrc),
  'a vehicle is what asks for that lift, because a vehicle is what the sea reader lifts',
);
ok(
  /touch\(this, playerPos, wader, 1\.1, null, 1\);/.test(worldSrc) && /touch\(t, t\.pos, wader, 1\.0, null, 0\.9\);/.test(worldSrc),
  'and the player and every other body ask with no lift at all: on foot the flat table is still the whole story',
);

// Why those two pins are worth having, in metres. The springs settle a corner 0.75 * ride over the
// floor (four corners of k * (ride - dist) summing to m * g, at k = m * g / (4 * 0.25 * ride)), so
// the headroom `onWater` is left with on flat water is 0.85 * ride + 0.3. Measured against the flat
// table, the swell spends it.
let crest = 0;
for (let i = 0; i < 300; i++) {
  for (let j = 0; j < 300; j++) crest = Math.max(crest, at(i * 1.37, j * -0.91, (i * 300 + j) * 0.0007));
}
ok(crest > 1 && crest <= REACH, `over 90,000 points and clocks the sea's crests reach ${crest.toFixed(2)} m over the table (of the ${REACH.toFixed(2)} m the eight amplitudes could ever make)`);
for (const hover of [0.65, 0.5, 0.15]) {
  ok(
    crest > 0.85 * hover + 0.3,
    `so at hover ${hover.toFixed(2)} m, where the headroom is ${(0.85 * hover + 0.3).toFixed(2)} m, a hull read against the flat table really would stop being "on water" while it rode a crest`,
  );
}

// --- what it costs ------------------------------------------------------------------------------------------

// Not a timing (this machine is not the owner's and the tab is hidden), but a count: the springs ask
// the reader once per hover point per physics step, and the shallow fade is the gate that keeps the
// sum out of it wherever the swell is dead.
reset();
let asked = 0;
let flatSteps = 0;
for (let step = 0; step < 240; step++) {
  // 240 steps at 1/60 s: a four-cornered machine running out from the beach at 3 m/s.
  const depth = -0.5 + step * 0.05;
  let any = false;
  for (let corner = 0; corner < 4; corner++) {
    if (swellScaleAt(depth, 1, 0) > 0) {
      at(corner, 0, step / 60);
      asked++;
      any = true;
    }
  }
  if (!any) flatSteps++;
}
ok(asked === (240 - flatSteps) * 4 && flatSteps > 0 && asked < 960, `over 240 steps of a four-cornered hull running out from the shore the sum was asked ${asked} times of a possible 960: the first ${flatSteps} steps are in water too shallow to swell, and the gate kept the sum out of every one of them`);

// --- the report -----------------------------------------------------------------------------------------------

reset();
ok(seaFeedReport().why === null, 'with the switch on and a scale to speak of, the report has nothing to complain about');
tuneSeaFeed({ on: false });
ok(seaFeedReport().why !== null && seaFeedReport().why!.includes('on: true'), 'with it off, it says so and names the knob that mends it');
reset();
ok(seaFeedReport().fade === SWELL_FADE, 'and it hands the shader\'s own edges back rather than a copy of them, so the console shows what the water really runs on');

reset();
console.log(`\n${passed} checks passed`);
