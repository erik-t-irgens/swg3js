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
  waterTopAt,
  type WaterLineQuery,
  type WaterLineVerdict,
} from '../../../src/world/waterLineMath.ts';
import { FOOT_TUNE, resolveSurface, type SurfaceSource } from '../../../src/audio/footsteps.ts';

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

// --- the rooms that think they are under water ---------------------------------------------------

// The other half of the same question, for the reader the feet and the blade share
// (`World.footSurfaces.waterTop`): a room is never under the planet's water table, whatever height
// its floor stands at. The fixture is a planet built like Rori, whose converted pack gives its whole
// world one global table at 75 m, with a cave cut into the ground under it: the room's floor is
// 20 m below the water's surface, and read by height alone every step in it splashes and a lit blade
// hisses and boils indoors.
const LAKE_TOP = 75;
/** The cave: one room box in world metres, floor at 55 m, ceiling at 70, all of it under the table. */
const CAVE = { x0: -20, x1: 20, y0: 55, y1: 70, z0: -20, z1: 20 };
const asks = { n: 0 };
const inCave = (x: number, y: number, z: number): boolean => {
  asks.n++;
  return x >= CAVE.x0 && x <= CAVE.x1 && y >= CAVE.y0 && y <= CAVE.y1 && z >= CAVE.z0 && z <= CAVE.z1;
};
/** The reader as the world runs it: the terrain's own surface, then the room rule. */
const readWater = (x: number, y: number, z: number, surface = LAKE_TOP): number => waterTopAt(x, y, z, surface, inCave);

asks.n = 0;
ok(readWater(0, 56, 0) === -Infinity, 'standing on a cave floor 19 m under a planet\'s water table: no water at all');
ok(asks.n === 1, 'and the room was asked about exactly once');
asks.n = 0;
ok(readWater(200, 74, 200) === LAKE_TOP, 'a metre under the open lake\'s surface, well away from the cave: the surface, as before');
ok(asks.n === 1, 'the room is asked there too -- being under the surface is the whole of what makes it worth asking');
asks.n = 0;
ok(readWater(0, 80, 0) === LAKE_TOP && readWater(200, 200, 200) === LAKE_TOP, 'above the surface the answer is the surface');
ok(asks.n === 0, 'and the room is never asked there: dry land costs one compare more than it did and not one lookup');
asks.n = 0;
ok(readWater(0, -500, 0, -Infinity) === -Infinity && asks.n === 0, 'a planet (or a space zone) with no water over the point asks nothing either');
asks.n = 0;
ok(Number.isNaN(readWater(0, Number.NaN, 0)) === false && readWater(0, Number.NaN, 0) === LAKE_TOP && asks.n === 0, 'a height that is not a number keeps the surface it was handed and asks nothing');
ok(readWater(0, LAKE_TOP, 0) === LAKE_TOP, 'exactly at the surface is not under it');

// How often the branch is taken, which is what this fixture can honestly count: a walk of a hundred
// steps over dry ground asks the room nothing, and the only steps that ask are the ones the old
// reader would have called wading. What one of those asks *costs* is not measured here and cannot be
// -- `inCave` is a box, while the game's room test is `LayoutStreamer.indoorsAt`, a walk of the
// streamed portal buildings with a prefilter and a padded cell box each. This pins the count; the
// notes give the walk's own length over the converted packs.
asks.n = 0;
for (let i = 0; i < 100; i++) readWater(i * 3, 90, 0);
const dryAsks = asks.n;
asks.n = 0;
for (let i = 0; i < 100; i++) readWater(i * 3, 74, 0);
ok(dryAsks === 0 && asks.n === 100, `a hundred steps on dry ground: ${dryAsks} room lookups; a hundred in the shallows: ${asks.n}`);

// The feet inherit it, which is the point of mending the reader rather than the clause order: the
// water clause comes first as it always did, and now answers dry, so the room's own floor decides.
const names = { object: () => null, ground: (t: string) => (t === 'sand' ? 'sand' : null) };
const source = (surface: number): SurfaceSource => ({
  waterTop: (x: number, y: number, z: number) => waterTopAt(x, y, z, surface, inCave),
  roomSurface: () => 'stone',
  objectTemplate: () => null,
  groundTemplate: () => 'sand',
  space: () => null,
});
const step = (x: number, y: number, z: number, inside: boolean) => resolveSurface({ x, y, z, inside, player: true, last: null, deck: null }, source(LAKE_TOP), names, FOOT_TUNE);
ok(step(0, 56, 0, true).surface === 'stone' && step(0, 56, 0, true).from === 'room', 'a foot on that cave floor lands on the room\'s own surface');
ok(step(200, 73.5, 200, false).surface === null && step(200, 73.5, 200, false).from === 'water', 'and a foot chest deep in the open lake is still swimming, with no feet at all');
ok(step(200, 74.8, 200, false).surface === 'water' && step(200, 76, 200, false).surface === 'sand', 'ankle deep it wades and up on the shore it is sand: nothing outdoors moves');
// What the old reader did in that cave, written out so the diff is on the record: the surface alone
// put 19 m of water over a body standing on dry stone.
ok(LAKE_TOP - 56 > FOOT_TUNE.swim, `read by height alone that cave floor carried ${LAKE_TOP - 56} m of water, past the ${FOOT_TUNE.swim} m that silences the feet`);
// And the blade, which never reaches `resolveSurface` at all: its own test is `top > y`. That the
// real `SaberSounds.ask` takes this branch is pinned where `ask` itself can be run, in
// `audioRuntime.test.ts`; this is the rule the world hands it.
ok(!(readWater(0, 56, 0) > 56), 'a lit blade held on that cave floor is not in the water');
ok(readWater(200, 74, 200) > 74, 'and one held in the lake still is');

// Why the player's swim must **not** read this reader, written down so that moving it onto this one
// fails here rather than in the water. A room's box is padded and overhangs its hull, so a swimmer
// can enter one before the doorway is crossed -- swimming down to an entrance that sits under a lake
// is the plain case -- and the depth the swim works from is `surface - y`. With the room-aware
// reader that depth is -Infinity, which is not "a little less water": it fails every swim test at
// once, with no hysteresis able to soften it, so gravity comes back and buoyancy goes mid-stroke.
// The swim therefore reads `World.waterColumnAt`, which is the lava-filtered column and no room at
// all, and takes its room rule from the cell the portal renderer walked it through.
// The player's own threshold is 1.1 m with 0.3 m of slack once swimming; the feet's is close enough
// to stand for it here and is the one number this file already imports.
const SWIM_AT = FOOT_TUNE.swim;
const roomAwareDepth = readWater(0, 60, 0) - 60;
// `waterColumnAt` is `waterTopAt` with the room rule left out, which on this fixture is the surface
// it was handed: 15 m of lake stands over that point whether or not a box reaches it.
const columnDepth = LAKE_TOP - 60;
ok(roomAwareDepth === -Infinity, 'the room-aware reader hands a point inside a room box a depth of -Infinity');
ok(!(roomAwareDepth > SWIM_AT - 0.3), 'which fails even the slack an already-swimming body is given: it does not soften the swim, it switches it off');
ok(columnDepth === 15 && columnDepth > SWIM_AT, 'while the column the swim really reads keeps the 15 m of lake over that point, so a swimmer beside a wall goes on swimming');

console.log(`\n${passed} checks passed`);
