// Two blades meeting, without a renderer: the segment-to-segment maths in every configuration two
// blades get into, who gives way, the pair ring that keeps two blades lying together from sparking
// every frame, and the step itself against blades made of plain numbers.
import assert from 'node:assert/strict';
import { CLASH, CLASH_BUILD_ONLY, ClashRing, Clashes, clashOutcome, closestSegments, recoilAfter, recoilFor, recoilReach, tipSpeedOf, type ClashBlade, type ClashEffects, type ClashHolder, type NearestPair } from '../../../src/combat/clash.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number, what: string) => ok(Math.abs(a - b) <= tol, `${what} (${a.toFixed(4)} vs ${b.toFixed(4)})`);

const v = (x: number, y: number, z: number) => ({ x, y, z });
const out: NearestPair = { s: 0, t: 0, x: 0, y: 0, z: 0 };
const dist = (p1: { x: number; y: number; z: number }, q1: { x: number; y: number; z: number }, p2: { x: number; y: number; z: number }, q2: { x: number; y: number; z: number }) =>
  Math.sqrt(closestSegments(p1, q1, p2, q2, out));

// --- the geometry -----------------------------------------------------------------------------

// Two segments crossing, one over the other: the gap is the height between them and the nearest
// pair is over the crossing point.
near(dist(v(-1, 0, 0), v(1, 0, 0), v(0, 0.4, -1), v(0, 0.4, 1)), 0.4, 1e-6, 'crossing: the gap is the height between them');
near(out.s, 0.5, 1e-6, 'crossing: half way along the first');
near(out.t, 0.5, 1e-6, 'crossing: half way along the second');
near(out.y, 0.2, 1e-6, 'crossing: the point is the middle of the pair');

// Two that cross in plan but stop short of each other: the nearest points are an end and the middle.
near(dist(v(-1, 0, 0), v(-0.5, 0, 0), v(0, 0, -1), v(0, 0, 1)), 0.5, 1e-6, 'passing: the gap is between an end and the other segment');
near(out.s, 1, 1e-6, 'passing: at the first segment’s far end');

// Skew: one along x at y 0, one along z at y 1, neither over the other.
near(dist(v(-1, 0, 0), v(1, 0, 0), v(3, 1, -1), v(3, 1, 1)), Math.sqrt(1 + 4), 1e-6, 'skew and apart: the gap is between two ends');

// Parallel, side by side and overlapping: the gap is the distance between the lines.
near(dist(v(0, 0, 0), v(2, 0, 0), v(0.5, 0.25, 0), v(2.5, 0.25, 0)), 0.25, 1e-6, 'parallel and overlapping: the distance between the lines');
// Parallel, end to end and not overlapping: the gap is between the two near ends.
near(dist(v(0, 0, 0), v(1, 0, 0), v(1.5, 0, 0), v(2.5, 0, 0)), 0.5, 1e-6, 'collinear and apart: the gap is between the near ends');
// Touching only at the tips.
near(dist(v(0, 0, 0), v(1, 0, 0), v(1, 0, 0), v(1, 1, 0)), 0, 1e-9, 'tip to tip: no gap at all');
near(out.s, 1, 1e-9, 'tip to tip: at the first’s tip');
near(out.t, 0, 1e-9, 'tip to tip: at the second’s base');
// The same segment twice: coincident.
near(dist(v(0, 1, 0), v(0, 2, 0), v(0, 1, 0), v(0, 2, 0)), 0, 1e-9, 'coincident: no gap');
// A blade with no length yet (still igniting) is a point, and the maths must not divide by it.
near(dist(v(0, 0, 0), v(0, 0, 0), v(-1, 0.3, 0), v(1, 0.3, 0)), 0.3, 1e-6, 'a point against a segment');
near(dist(v(0, 0, 0), v(0, 0, 0), v(0, 0.5, 0), v(0, 0.5, 0)), 0.5, 1e-6, 'two points');
// Symmetry: the answer cannot depend on which blade is asked about first.
near(dist(v(-1, 0, 0), v(1, 0, 0), v(0, 0.4, -1), v(0, 0.4, 1)), dist(v(0, 0.4, -1), v(0, 0.4, 1), v(-1, 0, 0), v(1, 0, 0)), 1e-9, 'the pair is the same either way round');

// --- who gives way ----------------------------------------------------------------------------

ok(clashOutcome(CLASH.weights.strong, CLASH.weights.fast, 0.5, 0.5) === 1, 'even rolls: the strong style beats the fast one');
ok(clashOutcome(CLASH.weights.fast, CLASH.weights.strong, 0.5, 0.5) === -1, 'and the other way round');
ok(clashOutcome(CLASH.weights.medium, CLASH.weights.medium, 0.5, 0.5) === 0, 'two of a style on even rolls: a bind, and both are thrown back');
// The band is wide enough that a roll can turn a near pair over: staff 1.3 against dual 1.15.
ok(clashOutcome(CLASH.weights.dual, CLASH.weights.staff, 1, 0) === 1, 'the band is real: a top roll turns a near pair over');
ok(clashOutcome(CLASH.weights.strong, CLASH.weights.fast, 0, 1) === 0, 'at the two extremes even the strong style is only pulled level with the fast one');
ok(clashOutcome(2, 1, 0, 1) === 1, 'and a weight twice another’s cannot be turned over by the band at all');
ok(clashOutcome(0, 0, 0.5, 0.5) === 0, 'two blades with no weight at all: a bind rather than a divide by zero');

// --- the recoil: the whole of "thrown back" ------------------------------------------------------

// Three outcomes, three numbers. A bind is neither a win nor a loss and must not be read as one.
near(recoilFor(true, false), CLASH.recoilLoser, 1e-9, 'recoil: the blade that gave way takes the loser’s');
near(recoilFor(false, false), CLASH.recoilWinner, 1e-9, 'recoil: the one that kept its swing takes the winner’s');
near(recoilFor(false, true), CLASH.recoilBind, 1e-9, 'recoil: a bind takes its own, which is what `recoilBind` is for');
ok(recoilFor(false, true) !== recoilFor(false, false), 'recoil: and a bind is not the winner’s give wearing another name');
// The loser flag is false on both blades of a bind, so the bind flag has to be what decides.
near(recoilFor(true, true), CLASH.recoilBind, 1e-9, 'recoil: a bind is a bind whichever flag comes with it');
{
  const was = CLASH.recoilLoser;
  CLASH.recoilLoser = 4;
  near(recoilFor(true, false), 1, 1e-9, 'recoil: a give past 1 is held at 1');
  CLASH.recoilLoser = -2;
  near(recoilFor(true, false), 0, 1e-9, 'recoil: and one below 0 at 0');
  CLASH.recoilLoser = was;
}

// It springs out again over `recoilTime` and stops at nothing.
near(recoilAfter(1, CLASH.recoilTime), 0, 1e-9, 'recoil: a full give is gone after `recoilTime`');
near(recoilAfter(1, CLASH.recoilTime * 0.5), 0.5, 1e-9, 'recoil: and half gone half way through it');
near(recoilAfter(1, CLASH.recoilTime * 4), 0, 1e-9, 'recoil: a long frame never drives it below nothing');
near(recoilAfter(0, 1 / 60), 0, 1e-9, 'recoil: a blade that has not clashed stays at nothing');

// The give is a share of the lit length, and nothing else about the blade changes.
near(recoilReach(1.2, 1, 0), 1.2, 1e-9, 'recoil: with no give the blade draws its whole lit length');
near(recoilReach(1.2, 1, 1), 1.2 * (1 - CLASH.recoilDip), 1e-9, 'recoil: at a full give it is short by `recoilDip`');
near(recoilReach(1.2, 0.5, 1), 1.2 * 0.5 * (1 - CLASH.recoilDip), 1e-9, 'recoil: a blade half out gives the same share of what is out');
near(recoilReach(1.2, 1, 3), 1.2 * (1 - CLASH.recoilDip), 1e-9, 'recoil: a give past 1 cannot eat more of the blade than `recoilDip`');

// --- a swing measured, and a frame gap that is not one -------------------------------------------

near(tipSpeedOf(0.25, 1 / 60), 15, 1e-6, 'tip: a quarter of a metre in a frame is a swing');
ok(tipSpeedOf(0.25, 1 / 60) >= CLASH.swingSpeed, 'tip: and fast enough to count as one');
ok(tipSpeedOf(CLASH.tipJump * 2, 1 / 20) === 0, 'tip: a tip that crossed a room in one step is a frame gap, not a swing');
ok(tipSpeedOf(0.25, 0) === 0, 'tip: no time passed, no speed');
ok(tipSpeedOf(0, 1 / 60) === 0, 'tip: a tip that did not move is not swinging');

// --- the pair ring ----------------------------------------------------------------------------

{
  const ring = new ClashRing(4);
  ok(ring.take(1, 2, 10) === true, 'ring: a pair that has never clashed may');
  ok(ring.take(1, 2, 10) === false, 'ring: and not again on the same frame');
  ok(ring.take(2, 1, 10 + CLASH.again * 0.5) === false, 'ring: still not half way through the delay, whichever way round the pair comes');
  ok(ring.take(1, 2, 10 + CLASH.again * 1.01) === true, 'ring: once the delay has passed, again');
  ok(ring.take(1, 3, 10 + CLASH.again * 1.01) === true, 'ring: another pair is its own');
  ok(ring.held(10 + CLASH.again * 1.01) === 2, 'ring: two pairs inside their delay');
  ok(ring.held(10 + CLASH.again * 3) === 0, 'ring: and none once they have all aged out');
  // More pairs at once than the ring holds: the oldest gives way and the game goes on sparking.
  const small = new ClashRing(2);
  ok(small.size === 2, 'ring: the size it was made with');
  ok(small.take(1, 2, 0) && small.take(3, 4, 0) && small.take(5, 6, 0), 'ring: a third pair in a ring of two is still allowed to clash');
  ok(small.take(5, 6, 0) === false, 'ring: and the newest pair is the one it remembers');
  // The world's simulated time starts again at nought on every world load, and the player's own
  // blades outlive the world: a pair remembered at the end of one world must not be shut out of
  // the next one for ever.
  const kept = new ClashRing(4);
  ok(kept.take(1, 2, 900) === true, 'ring: a pair clashes late in one world');
  ok(kept.take(1, 2, 0) === true, 'ring: and again on the first frame of the next, the clock having gone back');
}

// --- the step ---------------------------------------------------------------------------------

interface FakeBlade extends ClashBlade {
  glowing: boolean;
  ignition: number;
  attacking: boolean;
  tipSpeed: number;
  clashWeight: number;
  owner: number;
  drawnBase: { x: number; y: number; z: number };
  drawnTip: { x: number; y: number; z: number };
  hits: number;
  lost: number;
  bound: number;
  /** What a renderer would have put in its recoil: the same `recoilFor` `SaberBlade.clashed` uses. */
  give: number;
}
let nextId = 0;
const blade = (over: Partial<FakeBlade> = {}): FakeBlade => {
  const b: FakeBlade = {
    id: ++nextId,
    owner: 0,
    glowing: true,
    ignition: 1,
    drawnBase: v(0, 1, 0),
    drawnTip: v(0, 2, 0),
    attacking: false,
    tipSpeed: 0,
    clashWeight: 1,
    clashColor: 0x3aa0ff,
    hits: 0,
    lost: 0,
    bound: 0,
    give: 0,
    clashed(loser: boolean, bind: boolean): void {
      b.hits++;
      if (loser) b.lost++;
      if (bind) b.bound++;
      b.give = Math.max(b.give, recoilFor(loser, bind));
    },
  };
  Object.assign(b, over);
  return b;
};
const holders = (...list: ClashBlade[]): ClashHolder[] => list.map((s) => ({ saber: s }));
const NONE: ClashHolder[] = [];
/** A pool of four lights, `free` of them standing dark, as `Effects` hands its own over. */
const pool = (free: number) => {
  const lights: { intensity: number }[] = [];
  for (let i = 0; i < 4; i++) lights.push({ intensity: i < free ? 0 : 3 });
  return lights;
};

{
  const c = new Clashes();
  c.rand = () => 0.5;
  // The player's blade, named, swinging; a fighter's, named, held still and crossing it.
  const mine = blade({ owner: 1, attacking: true, clashWeight: CLASH.weights.strong, drawnBase: v(-0.5, 1.2, 0), drawnTip: v(0.5, 1.2, 0) });
  const theirs = blade({ owner: 7, clashWeight: CLASH.weights.fast, drawnBase: v(0, 1.2, -0.5), drawnTip: v(0, 1.2, 0.5) });
  ok(c.update(100, [mine], holders(theirs), NONE) === 1, 'step: one blade swinging into another is a clash');
  ok(mine.hits === 1 && theirs.hits === 1, 'step: both blades were thrown back');
  ok(theirs.lost === 1 && mine.lost === 0, 'step: the strong style kept its swing and the fast one gave way');
  ok(c.events[0].at.y === 1.2 && Math.abs(c.events[0].at.x) < 1e-9, 'step: the sparks are at the nearest point between them');
  ok(c.update(100.01, [mine], holders(theirs), NONE) === 0, 'step: the same pair does not clash again on the next frame');
  ok(c.update(100 + CLASH.again * 1.01, [mine], holders(theirs), NONE) === 1, 'step: once the pair delay has passed, again');
  ok(c.total === 2, 'step: the running total counts both');
}

{
  const c = new Clashes();
  c.rand = () => 0.5;
  const across = { drawnBase: v(0, 1.2, -0.5), drawnTip: v(0, 1.2, 0.5) };
  const swung = { attacking: true, drawnBase: v(-0.5, 1.2, 0), drawnTip: v(0.5, 1.2, 0) };
  // Neither is swinging: two blades merely lying against one another never spark.
  ok(c.update(1, [blade({ owner: 1, drawnBase: v(-0.5, 1.2, 0), drawnTip: v(0.5, 1.2, 0) })], holders(blade({ owner: 2, ...across })), NONE) === 0, 'step: two blades held still never clash');
  // One hand's two blades (a staff, the dual style) never meet each other.
  ok(c.update(2, [blade({ owner: 1, ...swung }), blade({ owner: 1, ...across })], NONE, NONE) === 0, 'step: one hand’s two blades never clash');
  // Nor do two nobody named, which is the same case seen from the other side.
  ok(c.update(3, [blade({ ...swung }), blade({ ...across })], NONE, NONE) === 0, 'step: two blades nobody named never clash either');
  // A blade still igniting is not a blade yet.
  ok(c.update(4, [blade({ owner: 1, ...swung })], holders(blade({ owner: 2, ...across, ignition: 0.1 })), NONE) === 0, 'step: a blade barely out does not clash');
  ok(c.update(5, [blade({ owner: 1, ...swung })], holders(blade({ owner: 2, ...across, glowing: false })), NONE) === 0, 'step: nor does one that was not drawn this frame');
  // Too far apart.
  ok(c.update(6, [blade({ owner: 1, ...swung })], holders(blade({ owner: 2, drawnBase: v(0, 3, -0.5), drawnTip: v(0, 3, 0.5) })), NONE) === 0, 'step: blades that do not come within reach do not clash');
  // A peer's blade that nobody flags still clashes, because the blade itself measured a swing.
  ok(c.update(7, [blade({ owner: 1, drawnBase: v(-0.5, 1.2, 0), drawnTip: v(0.5, 1.2, 0), tipSpeed: CLASH.swingSpeed + 1 })], holders(blade({ owner: 2, ...across })), NONE) === 1, 'step: a measured swing counts as a swing');
  // The peers and the catalogue come in on the third list, which is weighed like the rest.
  ok(c.update(8, [], holders(blade({ owner: 3, ...swung })), holders(blade({ owner: 4, ...across }))) === 1, 'step: a fighter and another player’s blade clash with no player in it');
}

{
  // The switch: with the reach at nothing the game is exactly what it was before clashes existed.
  const c = new Clashes();
  const was = CLASH.reach;
  CLASH.reach = 0;
  ok(c.update(1, [blade({ owner: 1, attacking: true, drawnBase: v(-0.5, 1.2, 0), drawnTip: v(0.5, 1.2, 0) })], holders(blade({ owner: 2, drawnBase: v(0, 1.2, -0.5), drawnTip: v(0, 1.2, 0.5) })), NONE) === 0, 'step: reach 0 turns clashes off outright');
  CLASH.reach = was;
}

{
  // A bind: two blades of one style on even rolls. Both are thrown back and neither is the loser,
  // so the give they take has to be the bind's own number and not the winner's.
  const c = new Clashes();
  c.rand = () => 0.5;
  const one = blade({ owner: 1, attacking: true, clashWeight: CLASH.weights.medium, drawnBase: v(-0.5, 1.2, 0), drawnTip: v(0.5, 1.2, 0) });
  const two = blade({ owner: 2, clashWeight: CLASH.weights.medium, drawnBase: v(0, 1.2, -0.5), drawnTip: v(0, 1.2, 0.5) });
  ok(c.update(1, [one], holders(two), NONE) === 1, 'bind: two of a style on even rolls still clash');
  ok(c.events[0].bind === true, 'bind: and the event says so');
  ok(one.bound === 1 && two.bound === 1, 'bind: both blades were told it was a bind');
  ok(one.lost === 0 && two.lost === 0, 'bind: and neither of them gave way');
  near(one.give, CLASH.recoilBind, 1e-9, 'bind: the give is `recoilBind`');
  near(two.give, CLASH.recoilBind, 1e-9, 'bind: on both of them');
}

{
  // And a decided clash, so the two are seen to differ through the step and not only in `recoilFor`.
  const c = new Clashes();
  c.rand = () => 0.5;
  const strong = blade({ owner: 1, attacking: true, clashWeight: CLASH.weights.strong, drawnBase: v(-0.5, 1.2, 0), drawnTip: v(0.5, 1.2, 0) });
  const fast = blade({ owner: 2, clashWeight: CLASH.weights.fast, drawnBase: v(0, 1.2, -0.5), drawnTip: v(0, 1.2, 0.5) });
  c.update(1, [strong], holders(fast), NONE);
  ok(strong.bound === 0 && fast.bound === 0, 'decided: neither blade was told it was a bind');
  near(fast.give, CLASH.recoilLoser, 1e-9, 'decided: the blade that gave way took the loser’s give');
  near(strong.give, CLASH.recoilWinner, 1e-9, 'decided: and the other the winner’s');
}

{
  // Nothing is held between steps: the step's own list must not keep a renderer alive across a
  // world unload, whether anything remembers to call `clear` or not. A fighter's blade disposed
  // with its world would otherwise be held here until the next simulated frame.
  const c = new Clashes();
  ok(c.holding === 0, 'held: a step that has never run holds nothing');
  c.update(1, [blade({ owner: 1, attacking: true }), blade({ owner: 2 })], holders(blade({ owner: 3 })), NONE);
  ok(c.holding === 0, 'held: and nothing is held once a step with three lit blades in it has returned');
  c.clear();
  ok(c.holding === 0, 'held: nor after a world unload says so outright');
}

{
  // A world load starts `World.simTime` again at nought while the player's own blades live on.
  const c = new Clashes();
  c.rand = () => 0.5;
  const mine = () => blade({ owner: 1, attacking: true, drawnBase: v(-0.5, 1.2, 0), drawnTip: v(0.5, 1.2, 0) });
  const yours = () => blade({ owner: 2, drawnBase: v(0, 1.2, -0.5), drawnTip: v(0, 1.2, 0.5) });
  const a = mine();
  const b = yours();
  ok(c.update(900, [a], holders(b), NONE) === 1, 'reload: a pair clashes late in one world');
  ok(c.update(900.01, [a], holders(b), NONE) === 0, 'reload: and is inside its delay a moment later');
  ok(c.update(0, [a], holders(b), NONE) === 1, 'reload: the clock going back is a new world, not a pair waiting for ever');
}

{
  // The wiring gap the owner has to be able to see in numbers: blades nobody named.
  const c = new Clashes();
  const swung = { attacking: true, drawnBase: v(-0.5, 1.2, 0), drawnTip: v(0.5, 1.2, 0) };
  const across = { drawnBase: v(0, 1.2, -0.5), drawnTip: v(0, 1.2, 0.5) };
  ok(c.update(1, [blade({ ...swung }), blade({ ...across })], NONE, NONE) === 0, 'unnamed: two blades nobody named never clash');
  ok((c.status().unnamed as number) === 2, 'unnamed: and the report says how many there were');
  ok(c.update(2, [blade({ owner: 1, ...swung })], holders(blade({ owner: 2, ...across })), NONE) === 1, 'unnamed: named, the same pair clashes');
  ok((c.status().unnamed as number) === 0, 'unnamed: and the count is back to none');
}

{
  // The sparks: a pooled burst, the bank's own ring, and a flash only from a light standing dark.
  const c = new Clashes();
  c.rand = () => 0.5;
  let bursts = 0;
  let flashes = 0;
  let rings = 0;
  const fx = (free: number): ClashEffects => ({
    lightPool: pool(free),
    burst: () => {
      bursts++;
    },
    flash: () => {
      flashes++;
    },
  });
  const ring = {
    contact: () => {
      rings++;
    },
  };
  c.update(1, [blade({ owner: 1, attacking: true, drawnBase: v(-0.5, 1.2, 0), drawnTip: v(0.5, 1.2, 0) })], holders(blade({ owner: 2, drawnBase: v(0, 1.2, -0.5), drawnTip: v(0, 1.2, 0.5) })), NONE);
  c.place(fx(4), ring);
  ok(bursts === 1 && flashes === 1 && rings === 1, 'sparks: one burst, one borrowed flash and one ring per clash');
  ok(c.flashesPlaced === 1, 'sparks: and the report says the flash was really taken');
  // The pool the project deliberately ordered last: with every light spoken for the sparks still
  // show and nothing of somebody else's goes dark.
  bursts = flashes = rings = 0;
  c.place(fx(0), ring);
  ok(bursts === 1 && rings === 1, 'sparks: a busy pool still bursts and still rings');
  ok(flashes === 0 && c.flashesPlaced === 0, 'sparks: and takes no light away from the room lights, a fighter’s glow or a peer’s blade');
  // One light left and more clashes than that: at most that one is taken.
  bursts = flashes = 0;
  c.update(2, [blade({ owner: 1, attacking: true, drawnBase: v(-0.5, 1.2, 0), drawnTip: v(0.5, 1.2, 0) }), blade({ owner: 3, attacking: true, drawnBase: v(-0.5, 3.2, 0), drawnTip: v(0.5, 3.2, 0) })], holders(blade({ owner: 2, drawnBase: v(0, 1.2, -0.5), drawnTip: v(0, 1.2, 0.5) }), blade({ owner: 4, drawnBase: v(0, 3.2, -0.5), drawnTip: v(0, 3.2, 0.5) })), NONE);
  ok(c.count === 2, 'sparks: two clashes in one step');
  c.place(fx(1), null);
  ok(bursts === 2 && flashes === 1, 'sparks: two bursts, and only the one light that was standing dark');
  bursts = flashes = 0;
  c.clear();
  c.place(fx(4), null);
  ok(bursts === 0 && flashes === 0, 'sparks: nothing is drawn once the step is cleared');
}

{
  // The three numbers that are spent when the clashes are built: the report has to say what is
  // really in force rather than what was typed, or a console knob lies about a knob it cannot move.
  const c = new Clashes();
  const s = c.status();
  const build = s.buildOnly as Record<string, number>;
  ok(build.pairs === CLASH.pairs && build.maxBlades === CLASH.maxBlades && build.maxEvents === CLASH.maxEvents, 'build-only: the report names the sizes really in force');
  ok(CLASH_BUILD_ONLY.length === 3 && CLASH_BUILD_ONLY.indexOf('pairs') >= 0 && CLASH_BUILD_ONLY.indexOf('maxBlades') >= 0 && CLASH_BUILD_ONLY.indexOf('maxEvents') >= 0, 'build-only: and the knob knows the three by name');
}

console.log(`${checks} checks passed`);
