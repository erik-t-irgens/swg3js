// Holding a key to turn or raise a thing in hand (src/world/placeHold.ts): the hand's gain, the senses,
// the grid the wheel steps to, and the anchor that keeps a thing picked back up where it stood.
//
// What is worth pinning here, rather than what is easy to pin:
//
//  - **The total does not depend on the frame rate.** The rate is per pixel times a gain from the hand's
//    speed in pixels a second, so one hand path at one speed comes to one total at 30, 60 and 144 frames
//    a second, slow or fast.
//  - **The senses are the owner's words.** Mouse up turns it clockwise seen from above and raises it;
//    shift with it, up tips the top away from the viewer and right rolls the top right -- about the
//    view's own axes, for a camera facing anywhere, not the world's x and z.
//  - **The grid is strictly the next line**, either way, under nought too, and fifteen degrees read back
//    out of radians counts as on a line rather than a hair under it.
//  - **A thing picked back up holds its spot** until the player walks or looks past the two thresholds.
//  - **What a frame of a hold does is the module's own** (`applyHold`, `holdKindOf`, `tumbleAxes`,
//    `wheelDir`): the game hands it only the keys and the mouse, so the senses, the shift gate, the axes a
//    prop tumbles about and the slow hand's unrounded lift are run here rather than read off the game.
//
// Pure: the module under test imports only `propPlace.ts`'s turns, and the turns are checked through
// `propPlace.ts`'s own `applyTurn`, which is what the ghost is turned by.
//
// Run: node tools/swg/tests/placeHold.test.ts

import assert from 'node:assert/strict';
import {
  PLACE_HOLD_TUNE,
  anchorReleased,
  applyHold,
  holdGain,
  holdKindOf,
  holdState,
  keepLift,
  liftDelta,
  placeAnchor,
  stepToGrid,
  tumbleAxes,
  tumbleDeltas,
  turnDelta,
  turnTo,
  viewAxes,
  wheelDir,
  type ViewAxes,
} from '../../../src/world/placeHold.ts';
import { NO_TURN, PROP_TUNE, applyTurn, turnAbout } from '../../../src/world/propPlace.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const T = PLACE_HOLD_TUNE;
const DEG = Math.PI / 180;
/** The view's axes for a camera facing +Z, which a spin and a lift never read. */
const AX: ViewAxes = { fx: 0, fz: 1, rx: -1, rz: 0 };

// ---- the hand's gain -----------------------------------------------------------------------------

{
  const dt = 1 / 60;
  ok(holdGain(0, dt) === 1 && holdGain((T.knee * dt) / 2, dt) === 1, 'a still or slow hand moves at the base rate');
  ok(near(holdGain(T.knee * dt, dt), 1), 'and at the knee itself');
  ok(near(holdGain(T.fast * dt, dt), T.most) && near(holdGain(T.fast * 10 * dt, dt), T.most), 'a hand at or past `fast` moves at `most` times the base, and no more');
  let last = 0;
  let rising = true;
  for (let v = 0; v <= T.fast * 1.5; v += 25) {
    const g = holdGain(v * dt, dt);
    if (g < last - 1e-12) rising = false;
    last = g;
  }
  ok(rising, 'and the gain never falls as the hand goes faster');
  ok(near(holdGain(-T.fast * dt, dt), T.most), 'whichever way the hand moves');
  // A frame shorter than the floor counts as the floor, so a burst of tiny frames cannot read as a flick.
  ok(near(holdGain(1, 0.0001), holdGain(1, T.dtFloor)), 'a frame shorter than `dtFloor` is read as `dtFloor` long');
}

// ---- one hand path, any frame rate --------------------------------------------------------------

{
  // A hand moving at a constant speed for a second, cut into frames of each rate: the totals agree.
  const total = (fps: number, pxPerSecond: number, f: (dy: number, dt: number) => number) => {
    const dt = 1 / fps;
    let sum = 0;
    for (let i = 0; i < fps; i++) sum += f(-pxPerSecond * dt, dt);
    return sum;
  };
  for (const [speed, eps, words] of [
    [300, 1e-9, 'slow (under the knee)'],
    [1200, 1e-6, 'between the knee and fast'],
    [6000, 1e-6, 'fast (past `fast`)'],
  ] as const) {
    const turn = [30, 60, 144].map((fps) => total(fps, speed, (dy, dt) => turnDelta(dy, 0, dt, 1)));
    const lift = [30, 60, 144].map((fps) => total(fps, speed, (dy, dt) => liftDelta(dy, dt, 1, 'house')));
    ok(near(turn[0], turn[1], eps) && near(turn[1], turn[2], eps), `a ${words} turn comes to the same at 30, 60 and 144 frames a second (${(turn[1] / DEG).toFixed(3)} degrees)`);
    ok(near(lift[0], lift[1], eps) && near(lift[1], lift[2], eps), `and so does a ${words} lift (${lift[1].toFixed(4)} m)`);
  }
  // The smoke check's own numbers: a slow 100 px up turns 15 degrees clockwise and lifts a house 0.5 m.
  const slow = total(60, 300, (dy, dt) => turnDelta(dy, 0, dt, 1)) / 3;
  ok(near(slow / DEG, -15, 1e-9), `a slow 100 px up turns it 15 degrees, clockwise seen from above (a negative yaw): ${(slow / DEG).toFixed(3)}`);
  ok(near(total(60, 300, (dy, dt) => liftDelta(dy, dt, 1, 'house')) / 3, 0.5, 1e-9), 'and lifts a house half a metre');
  ok(near(total(60, 300, (dy, dt) => liftDelta(dy, dt, 1, 'prop')) / 3, 0.3, 1e-9), 'and a prop 0.3 m');
  // One frame of 100 px is 6,000 px a second: `most` times as far.
  ok(near(turnDelta(-100, 0, 1 / 60, 1) / DEG, -15 * T.most, 1e-9), `a flick of 100 px in one frame turns it ${15 * T.most} degrees`);
  ok(near(turnDelta(-10, 0, 1 / 60, 2), 2 * turnDelta(-10, 0, 1 / 60, 1)), 'the mouse sensitivity scales it as it scales looking round');
  ok(near(liftDelta(-10, 1 / 60, 2, 'prop'), 2 * liftDelta(-10, 1 / 60, 1, 'prop')) && near(liftDelta(-10, 1 / 60, 2, 'house'), 2 * liftDelta(-10, 1 / 60, 1, 'house')), 'and the lift, both kinds');
  const one = tumbleDeltas(7, -10, 1 / 60, 1, T, { tip: 0, roll: 0 });
  const two = tumbleDeltas(7, -10, 1 / 60, 2, T, { tip: 0, roll: 0 });
  ok(near(two.tip, 2 * one.tip) && near(two.roll, 2 * one.roll) && one.tip !== 0 && one.roll !== 0, 'and the tip and the roll');
}

// ---- the senses ---------------------------------------------------------------------------------

{
  ok(turnDelta(-5, 0, 1 / 60, 1) < 0, 'mouse up turns it clockwise seen from above, which is a negative yaw');
  ok(turnDelta(5, 0, 1 / 60, 1) > 0, 'and mouse down the other way');
  ok(turnDelta(0, 50, 1 / 60, 1) === 0, 'a sideways drag does nothing while `sideways` is off');
  ok(liftDelta(-5, 1 / 60, 1, 'house') > 0 && liftDelta(5, 1 / 60, 1, 'prop') < 0, 'mouse up raises it and mouse down lowers it');
  // The spin, through the very frame of a hold the game runs (`applyHold`): a quarter turn by mouse up
  // takes the thing's own +X to +Z, which is clockwise seen from above (from +X round toward the viewer's
  // south). The design's own line said -Z, which is anticlockwise and against its own table and smoke
  // check; the table (mouse up clockwise) is what is pinned.
  const quarter = -90 / (T.turnPerPx * 1); // pixels of a slow hand for a quarter turn
  const spun = { turn: { ...NO_TURN }, lift: 0 };
  const hs = holdState();
  for (let i = 0; i < 90; i++) applyHold(hs, 'turn', 0, quarter / 90, 1 / 60, 1, AX, spun, null, 8, i);
  const x = applyTurn(spun.turn, { x: 1, y: 0, z: 0 });
  ok(near(x.x, 0, 1e-9) && near(x.z, 1, 1e-9), `a quarter turn by mouse up takes the thing's own +X to +Z (${x.x.toFixed(3)}, ${x.z.toFixed(3)})`);
  // And the same by hand, turn on turn, so the hold is no more than the turns it is made of.
  let q = { ...NO_TURN };
  for (let i = 0; i < 90; i++) q = turnAbout(q, 0, 1, 0, turnDelta(quarter / 90, 0, 1 / 60, 1));
  ok(near(q.y, spun.turn.y) && near(q.w, spun.turn.w), 'which is exactly the per-frame turns about up composed one after another');
  // The flips and the sideways knob, put back afterwards.
  T.flipTurn = true;
  T.flipLift = true;
  ok(turnDelta(-5, 0, 1 / 60, 1) > 0 && liftDelta(-5, 1 / 60, 1, 'house') < 0, 'flipped, mouse up turns it anticlockwise and lowers it');
  T.flipTurn = false;
  T.flipLift = false;
  T.sideways = true;
  ok(turnDelta(0, 5, 1 / 60, 1) < 0 && near(turnDelta(-5, 0, 1 / 60, 1), turnDelta(0, 5, 1 / 60, 1)), 'with `sideways` on, mouse right turns it clockwise too, as far as mouse up does');
  T.sideways = false;
}

// ---- the tumble, about the view's own axes ------------------------------------------------------

{
  // Which hold the keys make: shift with the turn key tumbles a prop and only a prop, the turn key wins
  // over the height key, and the bar's buttons ask the same.
  ok(holdKindOf(true, false, true, true) === 'tumble', 'shift with the turn key tumbles a prop');
  ok(holdKindOf(true, false, true, false) === 'turn', 'and only spins a building, which never tips');
  ok(holdKindOf(true, false, false, true) === 'turn', 'the turn key alone spins a prop');
  ok(holdKindOf(true, true, false, false) === 'turn' && holdKindOf(true, true, true, true) === 'tumble', 'the turn key wins when both are held');
  ok(holdKindOf(false, true, true, true) === 'lift' && holdKindOf(false, true, false, false) === 'lift', 'the height key raises either, shift or no shift');
  ok(holdKindOf(false, false, true, true) === null, 'and neither held is no hold at all');

  // For a camera facing +Z and one facing -X: up tips the thing's top away from the viewer, right rolls
  // the top to the viewer's right. The axes are the view's level forward and its right (forward x up),
  // worked out by `tumbleAxes` from the camera's direction in the world, and the tumble is the very frame
  // of a hold the game runs (`applyHold`), so the axes it turns about and their signs are the game's.
  for (const [name, dx, dz] of [
    ['facing +Z', 0, 1],
    ['facing -X', -1, 0],
  ] as const) {
    // The camera looks a little down, as it does over the shoulder: only the level part counts.
    const ax = tumbleAxes(dx * 3, dz * 3, 1.234, { fx: 0, fz: 0, rx: 0, rz: 0 });
    ok(near(ax.fx, dx) && near(ax.fz, dz), `${name}: the view's level forward is the camera's own direction laid flat`);
    const forward = { x: ax.fx, z: ax.fz };
    const right = { x: ax.rx, z: ax.rz };
    // Right is forward turned a quarter clockwise seen from above: facing +Z, right is -X.
    ok(near(right.x, -forward.z) && near(right.z, forward.x), `${name}: right is forward x up`);
    const t = tumbleDeltas(0, -20, 1 / 60, 1, T, { tip: 0, roll: 0 });
    ok(t.tip < 0 && t.roll === 0, `${name}: mouse up is a tip and no roll`);
    const tipped = { turn: { ...NO_TURN }, lift: 0 };
    ok(applyHold(holdState(), 'tumble', 0, -20, 1 / 60, 1, ax, tipped, null, 8, 0), `${name}: a frame of the tumble moves it`);
    const top = applyTurn(tipped.turn, { x: 0, y: 1, z: 0 });
    const away = top.x * forward.x + top.z * forward.z;
    ok(away > 0.1 && top.y < 1 && near(top.x * right.x + top.z * right.z, 0, 1e-9), `${name}: mouse up tips the top away from the viewer and not aside (${away.toFixed(3)} along the view)`);
    const r = tumbleDeltas(20, 0, 1 / 60, 1, T, { tip: 0, roll: 0 });
    ok(r.roll > 0 && r.tip === 0, `${name}: mouse right is a roll and no tip`);
    const rolled = { turn: { ...NO_TURN }, lift: 0 };
    applyHold(holdState(), 'tumble', 20, 0, 1 / 60, 1, ax, rolled, null, 8, 0);
    const top2 = applyTurn(rolled.turn, { x: 0, y: 1, z: 0 });
    const aside = top2.x * right.x + top2.z * right.z;
    ok(aside > 0.1 && near(top2.x * forward.x + top2.z * forward.z, 0, 1e-9), `${name}: mouse right rolls the top to the viewer's right and not away (${aside.toFixed(3)})`);
    // And a building held with the turn key never tumbles, whatever shift says: it only spins.
    const house = { yaw: 1, lift: 0 };
    ok(!applyHold(holdState(), 'tumble', 20, -20, 1 / 60, 1, ax, null, house, 8, 0) && house.yaw === 1, `${name}: a building handed a tumble is not moved`);
  }
  ok(!viewAxes(0, 0, { fx: 0, fz: 0, rx: 0, rz: 0 }), 'a view straight up or down has no level forward to speak of');
  const down = tumbleAxes(0, 0, Math.PI / 2, { fx: 0, fz: 0, rx: 0, rz: 0 });
  ok(near(down.fx, 1) && near(down.fz, 0) && near(down.rx, 0) && near(down.rz, 1), "and then the body's heading stands in for it");
}

// ---- a frame of a hold, into the thing in hand ----------------------------------------------------

{
  const dt = 1 / 60;
  // A building: a slow 100 px up turns it 15 degrees clockwise, kept inside one turn, and lifts it 0.5 m.
  const house = { yaw: 0, lift: 0 };
  const h = holdState();
  for (let i = 0; i < 20; i++) applyHold(h, 'turn', 0, -5, dt, 1, AX, null, house, 8, i);
  ok(near(house.yaw, turnTo(-15 * DEG), 1e-9) && house.yaw > Math.PI, `a building's turn is written, kept in one turn (${(house.yaw / DEG).toFixed(3)} degrees)`);
  const lifted = { yaw: 0, lift: 0 };
  const hl = holdState();
  for (let i = 0; i < 20; i++) applyHold(hl, 'lift', 0, -5, dt, 1, AX, null, lifted, 8, i);
  ok(lifted.lift === 0.5 && lifted.yaw === 0, `and a building's lift (${lifted.lift} m), with its turn left alone`);
  // The lift reaches `most` and no further, both kinds.
  const high = { yaw: 0, lift: 0 };
  const hh = holdState();
  for (let i = 0; i < 40; i++) applyHold(hh, 'lift', 0, -200, dt, 1, AX, null, high, 8, i);
  ok(high.lift === 8 && hh.raw === 8, 'a building lifted far stops at the reach handed over');
  const deep = { turn: { ...NO_TURN }, lift: 0 };
  const hd = holdState();
  for (let i = 0; i < 400; i++) applyHold(hd, 'lift', 0, 200, dt, 1, AX, deep, null, 8, i);
  ok(deep.lift === -PROP_TUNE.most, `a prop dropped far stops at its own ${PROP_TUNE.most} m`);

  // A slow hand's lift: 3 mm a frame on a prop and 5 mm on a building, each under the centimetre the
  // thing keeps. Kept unrounded in the hold, a hundred frames come to 0.30 m and 0.50 m; rounded every
  // frame, the prop's would never move and the building's would come to twice that.
  const prop = { turn: { ...NO_TURN }, lift: 0 };
  const hp = holdState();
  for (let i = 0; i < 100; i++) applyHold(hp, 'lift', 0, -1, dt, 1, AX, prop, null, 8, i);
  ok(prop.lift === 0.3, `a hundred frames of a slow hand lift a prop 0.30 m (${prop.lift})`);
  const slowHouse = { yaw: 0, lift: 0 };
  const hsh = holdState();
  for (let i = 0; i < 100; i++) applyHold(hsh, 'lift', 0, -1, dt, 1, AX, null, slowHouse, 8, i);
  ok(slowHouse.lift === 0.5, `and a building 0.50 m (${slowHouse.lift})`);
  // Frames with no movement in a hold (a slow drag of the bar's button has them) keep the hold, and so
  // lose nothing.
  const gaps = { turn: { ...NO_TURN }, lift: 0 };
  const hg = holdState();
  let stillMoved = 0;
  for (let i = 0; i < 100; i++) {
    applyHold(hg, 'lift', 0, -1, dt, 1, AX, gaps, null, 8, i);
    if (applyHold(hg, 'lift', 0, 0, dt, 1, AX, gaps, null, 8, i)) stillMoved++;
  }
  ok(stillMoved === 0, 'a frame of the hold with no movement moves nothing');
  ok(gaps.lift === 0.3 && hg.which === 'lift', `a slow hand with still frames between still comes to 0.30 m (${gaps.lift})`);
  // A hold let go between moves starts afresh from the rounded lift every time, which is what a slow drag
  // did when the bar's hold lasted only for the frames the pointer moved.
  const lost = { turn: { ...NO_TURN }, lift: 0 };
  const hlost = holdState();
  for (let i = 0; i < 100; i++) {
    applyHold(hlost, 'lift', 0, -1, dt, 1, AX, lost, null, 8, i);
    applyHold(hlost, null, 0, 0, dt, 1, AX, lost, null, 8, i);
  }
  ok(lost.lift === 0, 'and the same hand with the hold let go between moves comes to nothing, which is why a bar button holds while it is down');
  // A new hold starts from the thing as it stands, so a lift a wheel step left is where the next hold begins.
  const stepped = { turn: { ...NO_TURN }, lift: 0.4 };
  const hst = holdState();
  applyHold(hst, 'lift', 0, -1, dt, 1, AX, stepped, null, 8, 5);
  ok(hst.which === 'lift' && hst.since === 5 && near(hst.raw, 0.403) && stepped.lift === 0.4, 'a hold begins from the lift as it stands');
  ok(!applyHold(hst, 'turn', 0, 0, dt, 1, AX, stepped, null, 8, 6) && hst.which === 'turn' && hst.since === 6, 'and a change of key starts the hold afresh even on a still frame');
  // A sideways drag spins nothing while `sideways` is off, and nothing at all is a hold that writes nothing.
  const still = { yaw: 2, lift: 0 };
  ok(!applyHold(holdState(), 'turn', 50, 0, dt, 1, AX, null, still, 8, 0) && still.yaw === 2, 'a sideways drag turns nothing with `sideways` off');
  ok(!applyHold(holdState(), null, 0, -50, dt, 1, AX, null, still, 8, 0) && still.yaw === 2, 'and no hold moves nothing');
  ok(!applyHold(holdState(), 'turn', 0, -50, dt, 1, AX, null, null, 8, 0), 'nor does a hold with nothing in hand');
  ok(keepLift(0.374, 8) === 0.37 && keepLift(-9, 8) === -8 && keepLift(12.345, 30) === 12.35, 'a lift is kept to the centimetre and within the reach handed over');
}

// ---- the wheel, with a key held ------------------------------------------------------------------

{
  // Up on the wheel is up on the mouse, both flips with it: a notch up goes the way a mouse moved up does.
  const dt = 1 / 60;
  for (const flip of [false, true]) {
    T.flipTurn = flip;
    T.flipLift = flip;
    const words = flip ? 'flipped' : 'unflipped';
    ok(Math.sign(wheelDir('turn', 1)) === Math.sign(turnDelta(-1, 0, dt, 1)) && wheelDir('turn', -1) === -wheelDir('turn', 1), `${words}, a notch up turns it the way mouse up does`);
    ok(Math.sign(wheelDir('lift', 1)) === Math.sign(liftDelta(-1, dt, 1, 'house')) && wheelDir('lift', -1) === -wheelDir('lift', 1), `${words}, a notch up raises it the way mouse up does`);
    ok(Math.sign(wheelDir('tumble', 1)) === Math.sign(tumbleDeltas(0, -1, dt, 1, T, { tip: 0, roll: 0 }).tip) && wheelDir('tumble', -1) === -wheelDir('tumble', 1), `${words}, a notch up tips it the way mouse up does`);
  }
  T.flipTurn = false;
  T.flipLift = false;
  ok(wheelDir('turn', 1) === -1 && wheelDir('lift', 1) === 1 && wheelDir('tumble', 1) === -1, 'unflipped, a notch up is clockwise (a smaller yaw), up, and a tip away');
}

// ---- the grid ------------------------------------------------------------------------------------

{
  ok(stepToGrid(30, 15, 1) === 45 && stepToGrid(30, 15, -1) === 15, 'a value on a line steps to the next one either way');
  ok(stepToGrid(31, 15, 1) === 45 && stepToGrid(31, 15, -1) === 30, 'a value between lines steps to the line beyond it that way');
  ok(stepToGrid(-7, 15, 1) === 0 && stepToGrid(-7, 15, -1) === -15 && stepToGrid(-15, 15, -1) === -30, 'and under nought the same');
  ok(stepToGrid(345, 15, 1) === 360, '345 degrees and a notch is 360, which the game keeps as nought');
  const fromRadians = (((15 * Math.PI) / 180) * 180) / Math.PI;
  ok(stepToGrid(fromRadians, 15, 1) === 30, 'fifteen degrees read back out of radians is on its line, not a hair under it');
  // Read back out of radians a line lands a hair either side of itself (75, 150, 285 and 300 a hair over),
  // so a notch either way from every line of two whole turns, each way round, is exactly the next line.
  const viaRadians = (d: number) => (((d * Math.PI) / 180) * 180) / Math.PI;
  const off: number[] = [];
  for (let d = -720; d <= 720; d += 15) {
    if (stepToGrid(viaRadians(d), 15, 1) !== d + 15 || stepToGrid(viaRadians(d), 15, -1) !== d - 15) off.push(d);
  }
  ok(off.length === 0 && viaRadians(75) > 75, `every line read back out of radians, over or under, steps a whole notch either way${off.length ? ` (not ${off.join(', ')})` : ''}`);
  ok(stepToGrid(0.3, 0.1, 1) > 0.39 && stepToGrid(0.3, 0.1, 1) < 0.41, 'three tenths and a notch of a tenth is four tenths, not three again');
  ok(stepToGrid(5, 0, 1) === 5 && stepToGrid(5, 15, 0) === 5, 'no grid, or no direction, moves nothing');
}

// ---- the anchor ----------------------------------------------------------------------------------

{
  const a = placeAnchor();
  a.on = true;
  a.px = 10;
  a.pz = -4;
  a.yaw = 0.5;
  ok(!anchorReleased(a, { x: 10, z: -4 }, 0.5), 'standing still and looking the same way, it holds');
  ok(!anchorReleased(a, { x: 10 + T.anchorMove * 0.9, z: -4 }, 0.5), `a step under ${T.anchorMove} m holds it`);
  ok(anchorReleased(a, { x: 10 + T.anchorMove * 1.1, z: -4 }, 0.5), 'and one past it lets go');
  ok(!anchorReleased(a, { x: 10, z: -4 }, 0.5 + T.anchorTurn * 0.9 * DEG), `a look under ${T.anchorTurn} degrees aside holds it`);
  ok(anchorReleased(a, { x: 10, z: -4 }, 0.5 - T.anchorTurn * 1.1 * DEG), 'and one past it lets go, either way');
  a.yaw = Math.PI - 0.01;
  ok(!anchorReleased(a, { x: 10, z: -4 }, -Math.PI + 0.01), 'two headings either side of the half turn are measured the short way round');
  a.yaw = -Math.PI + 0.01;
  ok(!anchorReleased(a, { x: 10, z: -4 }, Math.PI - 0.01), 'whichever of the two the anchor holds');
  ok(anchorReleased(a, { x: 10, z: -4 }, Math.PI - 0.01 - T.anchorTurn * 1.1 * DEG - 0.02), 'and a real turn across the half turn still lets go');
}

console.log(`\n${checks} checks passed`);
