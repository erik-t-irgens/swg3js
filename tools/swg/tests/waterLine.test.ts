// Where the water's surface line is: the margin, the swell's reach, the 20 cm of hysteresis, the
// lava guard and the depth. Pure arithmetic, so this test runs what the game runs. Every number in
// it is ours -- the game this recreates had no under water at all -- and the checks below are also
// the record of what each of the three call sites answered before the rule became one.
//
// (What the water looks like once you are under it is underwater.test.ts; this is only which side
// of the surface the eye is on.)
import assert from 'node:assert/strict';
import {
  WATER_LINE_TUNE,
  coveringWaterShader,
  onSeaSurface,
  surfaceReach,
  underwaterMargin,
  underwaterVerdict,
  type WaterLineQuery,
  type WaterLineVerdict,
} from '../../../src/world/waterLineMath.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const close = (a: number, b: number, msg: string, eps = 1e-9) => ok(Math.abs(a - b) <= eps, `${msg} (${a} ~ ${b})`);

const out = (): WaterLineVerdict => ({ under: false, submerged: false, depth: 0 });
const q = (over: Partial<WaterLineQuery> = {}): WaterLineQuery => ({ y: 0, surface: 0, reach: 0, wasUnder: false, lava: false, dry: false, ...over });
/** The surface's own height is 0 unless a check says otherwise, so `y` reads as height over the surface. */
const ask = (over: Partial<WaterLineQuery>, was = false): WaterLineVerdict => underwaterVerdict(q({ ...over, wasUnder: was }), out());
/**
 * A **snapshot**, not a constant: the sea's reach is `waveReach` in `src/world/water.ts`, a runtime
 * sum over the wave set `seaState` builds from its seed, and 1.19 m is what that came to when this
 * was written. Change the wave count, the amplitude share or the seed and the real margin moves
 * while every check below still passes, so read these as "about a metre of swell" and not as a pin.
 */
const SEA = 1.19;
const LAKE = WATER_LINE_TUNE.lakeReach;

// --- the margin itself -------------------------------------------------------------------------

close(underwaterMargin(0, false), WATER_LINE_TUNE.floor, 'no reach at all: the floor');
close(underwaterMargin(LAKE, false), WATER_LINE_TUNE.floor, 'a lake: reach + margin is 0.25, so the floor of 0.3 wins');
close(underwaterMargin(LAKE, true), 0.45, 'a lake, already under: 0.15 + 0.1 + 0.2');
close(underwaterMargin(SEA, false), 1.29, 'the sea: swell + margin');
close(underwaterMargin(SEA, true), 1.49, 'the sea, already under: swell + margin + hysteresis');
close(underwaterMargin(SEA, true) - underwaterMargin(SEA, false), WATER_LINE_TUNE.hysteresis, 'hysteresis is exactly the difference the last answer makes');
ok(underwaterMargin(Number.NaN, false) === WATER_LINE_TUNE.floor && underwaterMargin(-5, false) === WATER_LINE_TUNE.floor, 'a reach that is not a positive number is no reach');

// --- what each call site answered before, and answers now ---------------------------------------

// The lens flare's, `World.cameraUnderwater`. **This row is not a verified diff.** The margins this
// rule reproduces are the ones the wave's research pass recorded, and it recorded the flare's as a
// flat +0.3 m; the package that wrote this rule recorded it as `waterBodies.underwater || y <
// surface + 0.3`. The two differ over the open sea, where the first would have the flare go out at
// 0.30 m and this rule takes it out at 1.29 m, and no check here can tell them apart -- only a diff
// of `World.cameraUnderwater` against ff6f7b2 can. Over a lake the two readings agree and these
// four checks pin the numbers either way.
ok(!ask({ y: 0.31, reach: LAKE }).under, 'over a lake, 31 cm up and dry: still dry, as the old flat 0.3 m branch said');
ok(ask({ y: 0.29, reach: LAKE }).under, 'over a lake, 29 cm up: under, as the old flat 0.3 m branch said');
ok(ask({ y: 0.44, reach: LAKE }, true).under, 'over a lake, already under at 44 cm up: still under, as the old hysteresis said');
ok(!ask({ y: 0.46, reach: LAKE }, true).under, 'over a lake, already under at 46 cm up: dry again, as the old hysteresis said');
ok(ask({ y: 1.28, reach: SEA }).under && !ask({ y: 1.3, reach: SEA }).under, 'over the sea the swell decides and the floor never bites');

// The reflections' own (WaterBodies.underwater) had the same numbers without the floor, so over a
// lake it stopped them at 0.25 m and now stops them at 0.30 m. That 5 cm is the only number in the
// game this pass moves, and it moves the reflections only.
close(underwaterMargin(LAKE, false) - (LAKE + WATER_LINE_TUNE.margin), 0.05, 'over a lake the reflections stop 5 cm sooner than they used to (0.30 m, not 0.25 m)');

// The weather is the one asker that is NOT given this rule, and that is the point: its particles are
// scene geometry behind the `weather` setting, nothing to do with the Effects switch, so a margin
// here would stop the rain with Effects off while the player stood in the shallows. It keeps
// `cam.y < waterAt(cam)`. What the band costs, if it ever were handed over, is what these show.
ok(ask({ y: 0.2, reach: LAKE }).under && !ask({ y: 0.2, reach: LAKE }).submerged, 'a hand\'s width over a lake: within reach of a ring, and not under water');
ok(ask({ y: 1.2, reach: SEA }).under && !ask({ y: 1.2, reach: SEA }).submerged, 'waist-deep in the sea, eye 1.2 m up: a crest could reach it, and the head is plainly in the air');

// --- the hysteresis does not walk --------------------------------------------------------------

// Asking twice at one point must answer the same twice, or a caller that asks from two places in a
// frame (the reflections in beginWaterFrame, the flare in drawFrame, the weather in its own half)
// would see the verdict creep out from under it.
for (const y of [-2, -0.1, 0.24, 0.26, 0.29, 0.31, 0.44, 0.46, 1.28, 1.3, 5]) {
  for (const reach of [0, LAKE, SEA]) {
    for (const was of [false, true]) {
      const rec: WaterLineVerdict = { under: was, submerged: false, depth: 0 };
      const first = underwaterVerdict(q({ y, reach, wasUnder: rec.under }), rec).under;
      const second = underwaterVerdict(q({ y, reach, wasUnder: rec.under }), rec).under;
      const third = underwaterVerdict(q({ y, reach, wasUnder: rec.under }), rec).under;
      assert.equal(second, first, `asking twice at y=${y} reach=${reach} was=${was}`);
      assert.equal(third, first, `asking three times at y=${y} reach=${reach} was=${was}`);
    }
  }
}
ok(true, 'asking the same point again never changes the answer (66 states, three asks each)');

// The case the hysteresis is there for: a small chop riding on a surface right at the line. Without
// it the answer changes twice a wave for as long as the swimmer floats there; with it, once.
const flipsWith = (hysteresis: boolean, reach: number): number => {
  const rec: WaterLineVerdict = { under: false, submerged: false, depth: 0 };
  let flips = 0;
  for (let i = 0; i < 400; i++) {
    // The eye held still exactly on the line for a flat surface; the surface breathing 5 cm either side.
    const surface = 0.05 * Math.sin(i * 0.3);
    const before = rec.under;
    underwaterVerdict(q({ y: WATER_LINE_TUNE.floor, surface, reach, wasUnder: hysteresis ? rec.under : false }), rec);
    if (rec.under !== before) flips++;
  }
  return flips;
};
ok(flipsWith(false, LAKE) > 20, `without the hysteresis a chop at the line flips the answer ${flipsWith(false, LAKE)} times in 400 steps`);
ok(flipsWith(true, LAKE) <= 1, `with it, ${flipsWith(true, LAKE)}: a crest passing the eye cannot flicker the reflections, the flare or the chain's own pass`);
// Worth knowing rather than a bug: with no reach at all the floor is already the whole margin, so
// the hysteresis adds nothing -- which is exactly what the game did before this rule was one.
close(underwaterMargin(0, true), underwaterMargin(0, false), 'water with no reach of its own gets no hysteresis, as it never did', 1e-12);

// --- the lava guard ----------------------------------------------------------------------------

ok(!ask({ y: -50, lava: true }).under, 'deep under a lava flow is not under water');
ok(ask({ y: -50 }).under, 'deep under the same surface without the lava flag is');
ok(ask({ y: -50, lava: true }).depth === 0, 'lava hands the chain no depth to draw with');
// The guard beats the hysteresis: a swimmer who crossed from water onto a flow is out at once.
ok(!ask({ y: -50, lava: true }, true).under, 'already under, and now over lava: out at once, hysteresis or not');

// --- nowhere water can be ----------------------------------------------------------------------

ok(!ask({ y: -100, dry: true }).under, 'a space zone, a building\'s rooms or no planet: never under, however low the point is');
ok(!ask({ y: -100, surface: -Infinity }).under, 'a dry point (no table over it) is never under');
ok(!ask({ y: Number.NaN }).under && !ask({ surface: Number.NaN }).under, 'a number that is not a number is never under');

// --- the depth ---------------------------------------------------------------------------------

close(ask({ y: -3 }).depth, 3, 'three metres under the surface is three metres of water');
close(ask({ y: 0.2, reach: LAKE }).depth, 0, 'inside the margin band, above the true surface: no depth, so nothing it drives pops on');
close(ask({ y: 0 }).depth, 0, 'exactly at the surface: no depth');
ok(ask({ y: 10 }).depth === 0, 'above the water: no depth');
// The depth rises smoothly from the line: no step anywhere in the first metre under it.
let worst = 0;
let previous = 0;
for (let i = 0; i <= 100; i++) {
  const d = ask({ y: 0.3 - i * 0.01, reach: LAKE }).depth;
  worst = Math.max(worst, d - previous);
  previous = d;
}
ok(worst <= 0.0101, `the depth rises by at most ${worst.toFixed(4)} m a centimetre of descent: no step at the line`);

// --- the two verdicts are different facts --------------------------------------------------------

// `under` is the safe one and `submerged` the true one. Anything that draws reads the second: over
// the open sea the band between them is up to a metre and a half of open air.
ok(!ask({ y: 0.0001 }).submerged, 'a tenth of a millimetre over the surface: not submerged');
ok(ask({ y: -0.0001 }).submerged, 'a tenth of a millimetre under it: submerged');
for (const reach of [0, LAKE, SEA]) {
  for (const was of [false, true]) {
    for (let i = 0; i <= 400; i++) {
      const y = 2 - i * 0.01;
      const v = ask({ y, reach }, was);
      assert.equal(v.submerged, v.depth > 0, `submerged is exactly depth > 0 at y=${y.toFixed(2)} reach=${reach}`);
      assert.ok(!v.submerged || v.under, `submerged implies under at y=${y.toFixed(2)} reach=${reach}`);
      assert.ok(!(y > 0) || !v.submerged, `never submerged above the surface at y=${y.toFixed(2)} reach=${reach}`);
    }
  }
}
ok(true, 'over 2,406 heights: submerged is exactly depth > 0, always implies under, and is never true above the surface');
ok(!ask({ y: -5, lava: true }).submerged && !ask({ y: -5, dry: true }).submerged, 'lava and a dry point are not submerged either');

// --- the decisions world.ts used to make inline --------------------------------------------------

// Which reach applies. A lake's is fixed; the sea's is measured at load and handed in.
close(surfaceReach(false, 99), LAKE, 'not over the sea: a lake\'s own reach, whatever the swell is');
close(surfaceReach(true, SEA), SEA, 'over the sea: the swell itself');
ok(surfaceReach(true, Number.NaN) === 0 && surfaceReach(true, -1) === 0, 'a swell that is not a positive number is no reach, so the floor decides');

// Whether the surface over a point is the sea. The compare is float-exact and must stay so: the
// terrain hands back the global table's height itself wherever no local table wins.
ok(onSeaSurface(12, 12, true), 'the surface is exactly the global table\'s height: that is the sea');
ok(!onSeaSurface(12.0001, 12, true), 'a table a tenth of a millimetre above it is a lake, not the sea');
ok(!onSeaSurface(12, 12, false), 'a planet with no global sea drawn has no sea surface at all');
ok(!onSeaSurface(-Infinity, -Infinity, true), 'a dry point is not the sea either (no water level, no water)');

// Which look the water wears: the covering table's when that table is what the surface is.
ok(coveringWaterShader({ height: 12, shader: 'lake' }, false, 12, 'sea') === 'lake', 'a lake standing at the surface wears its own shader');
ok(coveringWaterShader({ height: 8, shader: 'lake' }, false, 12, 'sea') === 'sea', 'a table below the surface is not what the eye is under: the sea\'s');
ok(coveringWaterShader({ height: 12, shader: 'flow' }, true, 12, 'sea') === 'sea', 'a lava table is never a look');
ok(coveringWaterShader(null, false, 12, 'sea') === 'sea', 'no table at all: the sea\'s');
// A table standing at the surface but naming no shader is still the water the eye is under, so it
// takes no look rather than the sea's: `waterLookFor(null)` then gives it the planet's own water,
// which is the right answer and is what the code did before this rule was gathered into one place.
ok(coveringWaterShader({ height: 12, shader: '' }, false, 12, 'sea') === null, 'a table that names no shader takes the planet\'s own water, not the sea\'s');
ok(coveringWaterShader(null, false, 12, null) === null, 'and with no global shader either, no look: the record keeps the neutral one');

console.log(`\n${passed} checks passed`);
