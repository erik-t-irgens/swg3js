// Placing a prop: the two rules, the three-axis turn, and the store that keeps what went down.
//
// Node runs this with type stripping, so the modules under test are imported with their extensions
// and neither of them may touch three, rapier or the DOM.
//
// What is worth pinning here, rather than what is easy to pin:
//
//  - **The turn is about the world's axes, not the thing's.** A player pressing "turn left" twice
//    means the same thing both times; composed the other way round the second press turns about an
//    axis the first press moved, and a crate laid on its side then spins about its own length. The
//    test is that a yaw after a tip is still a yaw.
//  - **A rug is not buried.** Buried is every point under the floor. A thing lying flush, and a
//    thing half sunk, both stand.
//  - **A shelf bracket may reach into a wall.** The share is two thirds, so a couple of corners
//    inside something is fine and most of it inside is not.
//  - **A world that cannot answer forgives.** In a node test `floorAt` is null everywhere; nothing
//    may be refused for that, or the rule would refuse everything the moment a placement happened
//    over a hole.
//  - **A minted id is never reused**, which is the one thing in the store that could quietly cost a
//    player a chair: two rows claiming one thing is a row overwritten.

import { NO_TURN, PROP_TUNE, applyTurn, liftTo, propPoints, propSpot, propVerdict, pushBy, spinOf, tiltOf, turnAbout, turnBy, type PropBox, type PropTurn, type PropVerdict } from '../../../src/world/propPlace.ts';
import { PLACE_HOLD_TUNE, stepToGrid } from '../../../src/world/placeHold.ts';
import { PLACED_TUNE, PlacedProps, letGoOf, mintThing, placedTally, propsKey, readRow, type PlacedProp } from '../../../src/world/propsPlaced.ts';

let checks = 0;
let bad = 0;
function ok(what: string, pass: boolean, note = ''): void {
  checks++;
  if (!pass) {
    bad++;
    console.log(`  FAIL ${what}${note ? `: ${note}` : ''}`);
  }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- The turn ----------------------------------------------------------------------------------

const RAD = Math.PI / 180;
{
  const yaw90 = turnBy(NO_TURN, 'y', 90 * RAD);
  const p = applyTurn(yaw90, { x: 1, y: 0, z: 0 });
  // A right-handed yaw about +Y takes +X to -Z.
  ok('a yaw about up turns x onto -z', near(p.x, 0, 1e-9) && near(p.y, 0) && near(p.z, -1, 1e-9), `got ${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}`);

  // Turn it on its side, then turn it left. The second press must still be about the world's up: a
  // point straight up in the thing's own frame ends up somewhere level, and level it stays.
  const tipped = turnBy(NO_TURN, 'x', 90 * RAD);
  const up = applyTurn(tipped, { x: 0, y: 1, z: 0 });
  ok('a tip about x lays the thing down', near(up.y, 0, 1e-9), `up.y ${up.y.toFixed(4)}`);
  const tippedThenYawed = turnBy(tipped, 'y', 90 * RAD);
  const up2 = applyTurn(tippedThenYawed, { x: 0, y: 1, z: 0 });
  ok('a yaw after a tip is still a yaw (world axes, not the thing\'s)', near(up2.y, 0, 1e-9), `up.y ${up2.y.toFixed(4)}`);

  // And composing the other way round is what that guards against: `q * r` turns about the thing's
  // own axis, which after the tip is not the world's up at all. The witness has to be a point off
  // that axis -- the thing's own up is exactly the axis a wrong yaw would turn about, so it does not
  // move either way and proves nothing. Its +X does.
  const wrong = (() => {
    const h = (90 * RAD) / 2;
    const r = { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
    const q = tipped;
    return {
      x: q.w * r.x + q.x * r.w + q.y * r.z - q.z * r.y,
      y: q.w * r.y - q.x * r.z + q.y * r.w + q.z * r.x,
      z: q.w * r.z + q.x * r.y - q.y * r.x + q.z * r.w,
      w: q.w * r.w - q.x * r.x - q.y * r.y - q.z * r.z,
    } as PropTurn;
  })();
  const sideRight = applyTurn(tippedThenYawed, { x: 1, y: 0, z: 0 });
  ok('a world-frame yaw keeps the thing\'s side level', near(sideRight.y, 0, 1e-9), `y ${sideRight.y.toFixed(4)}`);
  const sideWrong = applyTurn(wrong, { x: 1, y: 0, z: 0 });
  ok('the other composition order really does differ (the guard is not vacuous)', !near(sideWrong.y, 0, 1e-6), `y ${sideWrong.y.toFixed(4)}`);

  // A full turn about any axis comes back to where it started, within floating point.
  let q = NO_TURN;
  for (let i = 0; i < 24; i++) q = turnBy(q, 'z', 15 * RAD);
  const back = applyTurn(q, { x: 1, y: 2, z: 3 });
  ok('twenty-four notches of fifteen degrees is a full turn', near(back.x, 1, 1e-6) && near(back.y, 2, 1e-6) && near(back.z, 3, 1e-6), `${back.x.toFixed(4)}, ${back.y.toFixed(4)}, ${back.z.toFixed(4)}`);
  ok("the wheel's notch with the turn key held is fifteen degrees", PLACE_HOLD_TUNE.gridTurn === 15);

  // About any axis at all, not only the world's three: the view's own across and along axes, which is
  // what a tip and a roll are turned about. A turn about (1, 0, 0) is exactly a turn about the world's x.
  const viaAxis = turnAbout(NO_TURN, 1, 0, 0, 0.7);
  const viaName = turnBy(NO_TURN, 'x', 0.7);
  ok('a turn about an axis given as numbers is the same turn as about that axis by name', near(viaAxis.x, viaName.x, 1e-12) && near(viaAxis.w, viaName.w, 1e-12));
  // Written into the record it is handed, which may be the very turn it starts from: the frame turns a prop in place.
  const inPlace: PropTurn = { ...tipped };
  const same = turnAbout(inPlace, 0, 1, 0, 90 * RAD, inPlace);
  const fresh = turnBy(tipped, 'y', 90 * RAD);
  ok('turned in place, the answer is the record it was handed and the same turn as a fresh one', same === inPlace && near(inPlace.x, fresh.x, 1e-12) && near(inPlace.y, fresh.y, 1e-12) && near(inPlace.z, fresh.z, 1e-12) && near(inPlace.w, fresh.w, 1e-12));
  // A diagonal axis: a quarter turn about (1, 0, 1)/√2 takes its own axis nowhere.
  const s = Math.SQRT1_2;
  const diag = applyTurn(turnAbout(NO_TURN, s, 0, s, 90 * RAD), { x: 1, y: 0, z: 1 });
  ok('a turn about a level axis between x and z leaves that axis where it is', near(diag.x, 1, 1e-9) && near(diag.y, 0, 1e-9) && near(diag.z, 1, 1e-9));

  // The spin and the tilt the bar reads out, and what the wheel steps the spin along.
  ok('an unturned thing faces nought and stands upright', near(spinOf(NO_TURN), 0, 1e-12) && near(tiltOf(NO_TURN), 0, 1e-6));
  ok('a yaw of 40 degrees reads as a spin of 40', near(spinOf(turnBy(NO_TURN, 'y', 40 * RAD)), 40 * RAD, 1e-9));
  ok('a tip of 30 degrees reads as tipped 30, and leaves the spin', near(tiltOf(turnBy(NO_TURN, 'x', 30 * RAD)), 30 * RAD, 1e-9) && near(spinOf(turnBy(NO_TURN, 'x', 30 * RAD)), 0, 1e-9));
  // Laid with its own +Z straight up, the spin is read off its +X instead, and a turn about up still moves it by exactly that turn.
  const onEnd = turnBy(NO_TURN, 'x', -90 * RAD);
  const turned = turnBy(onEnd, 'y', 25 * RAD);
  ok('laid on its end, a turn about up still moves the spin by exactly that turn', near(spinOf(turned) - spinOf(onEnd), 25 * RAD, 1e-9));
  // And reads what it read just short of on its end, so the bar's readout neither sits a quarter turn off
  // nor jumps as a thing is tipped through upright: the +X reading is the +Z one, less its quarter turn.
  ok('laid on its end it still faces nought', near(spinOf(onEnd), 0, 1e-9));
  ok('and a hair short of on its end reads the same', near(spinOf(turnBy(NO_TURN, 'x', -89.9 * RAD)), spinOf(onEnd), 1 * RAD));
  const nearlyTurned = turnBy(turnBy(NO_TURN, 'x', -89.9 * RAD), 'y', 25 * RAD);
  ok('turned 25 degrees about up, on its end and a hair short of it read alike', near(spinOf(turned), 25 * RAD, 1e-9) && near(spinOf(nearlyTurned), spinOf(turned), 1 * RAD));
  // The wheel's step onto the grid: from 40 degrees the next line up is 45, however it lies.
  const at40 = turnBy(turnBy(NO_TURN, 'x', 20 * RAD), 'y', 40 * RAD);
  const spin = spinOf(at40) / RAD;
  const stepped = turnAbout(at40, 0, 1, 0, (stepToGrid(spin, PLACE_HOLD_TUNE.gridTurn, 1) - spin) * RAD);
  ok('a notch of the spin lands it on the next line of the grid, tipped or not', near(spinOf(stepped) / RAD, 45, 1e-6) && near(tiltOf(stepped), tiltOf(at40), 1e-9));
}

// ---- The points -------------------------------------------------------------------------------

const BOX: PropBox = { min: [-0.5, 0, -0.25], max: [0.5, 1, 0.25] };
{
  const pts = propPoints(BOX, { x: 10, y: 5, z: -3 }, NO_TURN);
  ok('a box is judged by its eight corners and its middle', pts.length === 9, `${pts.length} points`);
  const xs = pts.map((p) => p.x);
  ok('the points are where the thing stands', Math.min(...xs) === 9.5 && Math.max(...xs) === 10.5, `x ${Math.min(...xs)}..${Math.max(...xs)}`);
  const none = propPoints(null, { x: 1, y: 2, z: 3 }, NO_TURN);
  ok('a prop with no box is judged by its own point alone', none.length === 1 && none[0].x === 1);
  // A kept list is written into: its records are made the first time and written over after that.
  const kept: { x: number; y: number; z: number }[] = [];
  propPoints(BOX, { x: 10, y: 5, z: -3 }, NO_TURN, kept);
  const first = kept[3];
  const yawed = turnBy(NO_TURN, 'y', 0.5);
  propPoints(BOX, { x: 0, y: 0, z: 0 }, yawed, kept);
  const fresh = propPoints(BOX, { x: 0, y: 0, z: 0 }, yawed);
  ok('a kept list of points is written over, record for record', kept.length === 9 && kept[3] === first && fresh.every((p, i) => near(p.x, kept[i].x, 1e-12) && near(p.y, kept[i].y, 1e-12) && near(p.z, kept[i].z, 1e-12)));
  propPoints(null, { x: 4, y: 0, z: 0 }, NO_TURN, kept);
  ok('and cut to one for a prop with no box', kept.length === 1 && kept[0].x === 4);
}
{
  // The verdict written into a kept record, as the frame keeps one.
  const said: PropVerdict = { ok: false, why: 'x', inside: 0, of: 0, clearance: 0 };
  const v = propVerdict(BOX, { x: 0, y: 0, z: 0 }, NO_TURN, { floorAt: () => 0, solidAt: () => false }, PROP_TUNE, said);
  ok('a kept verdict is written into and handed back', v === said && said.ok && said.why === null && said.of === 9);
}

// ---- The two rules ------------------------------------------------------------------------------

const noWorld = { floorAt: () => null, solidAt: () => false };
{
  const v = propVerdict(BOX, { x: 0, y: 0, z: 0 }, NO_TURN, noWorld);
  ok('a world that cannot answer forgives', v.ok, v.why ?? '');
  ok('and says nothing was inside anything', v.inside === 0 && v.of === 9);
}
{
  // Flush on a floor at zero: the bottom four corners sit exactly on it.
  const flat = { floorAt: () => 0, solidAt: () => false };
  ok('a thing standing flush on the floor stands', propVerdict(BOX, { x: 0, y: 0, z: 0 }, NO_TURN, flat).ok);
  ok('a thing half sunk still stands', propVerdict(BOX, { x: 0, y: -0.5, z: 0 }, NO_TURN, flat).ok);
  const buried = propVerdict(BOX, { x: 0, y: -1.001, z: 0 }, NO_TURN, flat);
  ok('a thing wholly under the floor is refused', !buried.ok && buried.why === 'it would be buried', buried.why ?? 'stood');
  // A rug: no height at all, lying exactly on the floor. Every one of its points is AT the floor,
  // which is not under it, so it must stand. This is the case the rule is written around.
  const rug: PropBox = { min: [-1, 0, -1], max: [1, 0, 1] };
  ok('a rug lying flat is not buried', propVerdict(rug, { x: 0, y: 0, z: 0 }, NO_TURN, flat).ok);
  ok('and a rug a millimetre under the floor is', !propVerdict(rug, { x: 0, y: -0.001, z: 0 }, NO_TURN, flat).ok);
  ok('the clearance says how far the lowest point is off the floor', near(propVerdict(BOX, { x: 0, y: 2, z: 0 }, NO_TURN, flat).clearance, 2));
}
{
  // A wall filling everything with x > 0. A thing standing beside it reaches in with some corners.
  const wall = { floorAt: () => 0, solidAt: (x: number) => x > 0 };
  const beside = propVerdict(BOX, { x: -0.3, y: 0, z: 0 }, NO_TURN, wall);
  ok('a shelf bracket may reach into the wall it hangs on', beside.ok, `${beside.inside}/${beside.of} inside`);
  ok('and the count says how far in it reached', beside.inside === 4, `${beside.inside} inside`);
  // Measured, and deliberately generous: pushed until half of it plus the middle is in the wall,
  // five points of nine, it still stands. That is 0.556, under the share, and the owner's rule is
  // "not fully submersed" -- a thing sunk halfway into a pillar is a thing somebody meant to sink.
  const half = propVerdict(BOX, { x: 0.4, y: 0, z: 0 }, NO_TURN, wall);
  ok('a thing sunk halfway into a wall still stands', half.ok && half.inside === 5, `${half.inside}/${half.of} inside`);
  const swallowed = propVerdict(BOX, { x: 0.6, y: 0, z: 0 }, NO_TURN, wall);
  ok('a thing wholly the other side of a wall face is refused', !swallowed.ok && swallowed.why === 'it is inside a wall', `${swallowed.inside}/${swallowed.of}, ${swallowed.why ?? 'stood'}`);
  ok('the share is two thirds', PROP_TUNE.buriedShare === 0.67);
  // Exactly at the line: 6 of 9 is 0.667, which is over the share, so it is refused.
  const all = { floorAt: () => 0, solidAt: () => true };
  ok('a thing wholly inside something is refused', !propVerdict(BOX, { x: 0, y: 1, z: 0 }, NO_TURN, all).ok);
  // And it is the wall that refuses it, not the burial: it is a metre over the floor.
  ok('and it is refused for the wall, not for being buried', propVerdict(BOX, { x: 0, y: 1, z: 0 }, NO_TURN, all).why === 'it is inside a wall');
}

// ---- Part of the world -------------------------------------------------------------------------------

{
  // A permanent placement's guard (`PermanentLayer.guardedAt`): asked with the spot and the thing's own reach.
  const asked: number[] = [];
  const guarded = {
    floorAt: () => 0,
    solidAt: () => false,
    reserved: (x: number, z: number, r: number) => {
      asked.push(r);
      return Math.hypot(x - 10, z) < 2 + r ? 'Locker' : null;
    },
  };
  const v = propVerdict(BOX, { x: 10.5, y: 0, z: 0 }, NO_TURN, guarded);
  ok('a thing put down on something of the world\'s own is refused in its words', !v.ok && v.why === 'that is part of this world (Locker)', v.why ?? 'stood');
  ok('and the guard is asked with the thing\'s own reach on the ground', asked[0] === 0.5, `${asked[0]}`);
  ok('a thing clear of it stands', propVerdict(BOX, { x: 20, y: 0, z: 0 }, NO_TURN, guarded).ok);
  const said: PropVerdict = { ok: true, why: null, inside: 0, of: 0, clearance: 0 };
  const a = propVerdict(BOX, { x: 10, y: 0, z: 0 }, NO_TURN, guarded, PROP_TUNE, said).why;
  const b = propVerdict(BOX, { x: 10.2, y: 0, z: 0 }, NO_TURN, guarded, PROP_TUNE, said).why;
  // Two frames over one row say the same words. (That they are made once a name and not once a frame is the
  // function's own keeping, `partOfWorld`; a string compares by its letters, so nothing here can see it.)
  ok('and held over it frame after frame, it says the same words', a === b && a === 'that is part of this world (Locker)', a ?? 'stood');
  // No guard at all: exactly what it judged before.
  const plain = { floorAt: () => 0, solidAt: () => false };
  const withNone = { ...plain, reserved: () => null };
  const p1 = propVerdict(BOX, { x: 0, y: -0.5, z: 0 }, NO_TURN, plain);
  const p2 = propVerdict(BOX, { x: 0, y: -0.5, z: 0 }, NO_TURN, withNone);
  ok('no reserved dep, or one that names nothing, changes nothing', p1.ok === p2.ok && p1.why === p2.why && p1.inside === p2.inside && p1.clearance === p2.clearance);
}

// ---- The wheel and the height keys ---------------------------------------------------------------

{
  ok('the wheel pushes it out a quarter metre a notch', near(pushBy(3, 1), 3.25));
  ok('and stops at the far end', near(pushBy(PROP_TUNE.far, 10), PROP_TUNE.far));
  ok('and at the near end', near(pushBy(PROP_TUNE.near, -10), PROP_TUNE.near));
  ok('a lift is kept to the centimetre', liftTo(0.374) === 0.37 && liftTo(-1.236) === -1.24, `${liftTo(0.374)}, ${liftTo(-1.236)}`);
  ok('a notch of the wheel with the height key held is a tenth of a metre', near(liftTo(stepToGrid(0, PLACE_HOLD_TUNE.gridLiftProp, 1)), 0.1, 1e-12));
  let l = 0;
  for (let i = 0; i < 3; i++) l = liftTo(stepToGrid(l, PLACE_HOLD_TUNE.gridLiftProp, 1));
  ok('and three of them are three tenths, on the grid', l === 0.3, `${l}`);
  ok('and within thirty metres either way', near(liftTo(100000), PROP_TUNE.most) && near(liftTo(-100000), -PROP_TUNE.most));
  ok('the owner asked to be able to raise it quite far', PROP_TUNE.most >= 10);
}
{
  // Ahead of the player, and the heading convention is the body's, not the camera's: forward is
  // (sin, cos). Facing along +Z (heading 0) puts it in front at +Z, never behind.
  const ahead = propSpot({ x: 0, y: 1, z: 0 }, 0, 3);
  ok('a prop is held in front of the player, not behind', near(ahead.z, 3) && near(ahead.x, 0), `${ahead.x.toFixed(2)}, ${ahead.z.toFixed(2)}`);
  const right = propSpot({ x: 0, y: 1, z: 0 }, Math.PI / 2, 3);
  ok('and facing a quarter turn round it is out along +x', near(right.x, 3, 1e-9) && near(right.z, 0, 1e-9));
  ok('the spot keeps the player\'s own height, which the lift is then measured from', near(ahead.y, 1));
}

// ---- The store ------------------------------------------------------------------------------------

{
  ok('one key a world', propsKey('tatooine') === 'swg.props.tatooine' && propsKey('space_corellia') !== propsKey('tatooine'));
  // Minting: the id must be one no other row ever gets, because a repeat overwrites somebody's chair.
  const seen = new Set<string>();
  let n = 0;
  for (let i = 0; i < 20000; i++) seen.add(mintThing(1_700_000_000_000 + (i % 7), () => (n = (n * 1103515245 + 12345) % 2147483648) / 2147483648));
  ok('twenty thousand minted ids are twenty thousand ids', seen.size === 20000, `${seen.size} distinct`);
}
{
  const row = readRow({ thing: 'a', id: 'chair', x: 1, y: 2, z: 3, q: [0, 0, 0, 1] });
  ok('a good row reads back', !!row && row.id === 'chair' && row.q[3] === 1);
  ok('and carries no indoors flag it was not given', row !== null && row.inside === undefined);
  ok('an indoor row keeps that it was indoors', readRow({ thing: 'a', id: 'c', x: 0, y: 0, z: 0, q: [0, 0, 0, 1], inside: true })?.inside === true);
  ok('a row with no thing is not a row', readRow({ id: 'chair', x: 1, y: 2, z: 3, q: [0, 0, 0, 1] }) === null);
  ok('a row with a bad number is not a row', readRow({ thing: 'a', id: 'c', x: 'over there', y: 0, z: 0, q: [0, 0, 0, 1] }) === null);
  ok('a row with a short turn is not a row', readRow({ thing: 'a', id: 'c', x: 0, y: 0, z: 0, q: [0, 0, 1] }) === null);
  ok('nor is a number', readRow(7) === null);
  ok('nor is nothing', readRow(null) === null);
}

async function store(): Promise<void> {
  const stood: string[] = [];
  const took: string[] = [];
  const deps = {
    stand: async (r: PlacedProp) => {
      stood.push(r.thing);
      return true;
    },
    clear: (t: string) => void took.push(t),
  };
  let saved: PlacedProp[] = [];
  const save = (_w: string, rows: readonly PlacedProp[]) => void (saved = rows.map((r) => ({ ...r })));
  const back = { get: () => JSON.stringify(saved) };

  const p = new PlacedProps();
  await p.enter('tatooine', { get: () => null }, deps);
  ok('a world with nothing kept stands nothing', p.all.length === 0 && stood.length === 0);
  // And is still a world you can put something down in. This is the one that was missed: the arrival
  // skipped `enter` entirely when the browser had nothing kept for the world, to save fetching a
  // catalogue to stand nothing, and left the store with no world at all -- so the very first press
  // answered "there is no world to put it in", and so did every one after it. Nothing could ever be
  // placed on a machine that had not already placed something, which is every machine.
  ok('but it is still a world something can be put down in', p.inWorld === 'tatooine', `world "${p.inWorld}"`);
  const firstEver = await p.put('chair', { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], false, deps, save, 1, () => 0.5);
  ok('so the first thing ever placed goes down', !!firstEver, p.note);
  p.take(firstEver!.thing, deps, save);
  stood.length = 0;
  took.length = 0;
  saved = [];

  let tick = 1;
  const a = await p.put('chair', { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], false, deps, save, 1, () => (tick = (tick * 16807) % 2147483647) / 2147483647);
  const b = await p.put('chair', { x: 2, y: 0, z: 0 }, [0, 0, 0, 1], true, deps, save, 2, () => (tick = (tick * 16807) % 2147483647) / 2147483647);
  ok('two of a kind are two things', !!a && !!b && a.thing !== b.thing);
  ok('and the second one remembers it went down indoors', b?.inside === true && a?.inside === undefined);
  ok('both are standing', p.standing === 2 && stood.length === 2);
  ok('and both were written down', saved.length === 2);
  ok('the tally counts things and kinds apart', placedTally(p.all).placed === 2 && placedTally(p.all).kinds === 1);

  const gone = p.take(a!.thing, deps, save);
  ok('taking one up hands the row back', gone?.thing === a!.thing);
  ok('and takes it down by its own key', took.length === 1 && took[0] === a!.thing);
  ok('and leaves the other standing', p.all.length === 1 && p.all[0].thing === b!.thing && saved.length === 1);
  ok('taking one that is not there does nothing', p.take('nonsense', deps, save) === null && p.all.length === 1);

  // Nearest, which is what the pick-up key asks.
  ok('the nearest within reach is the one that is near', p.nearest({ x: 2, y: 0, z: 0 }, 3)?.thing === b!.thing);
  ok('and nothing answers from too far off', p.nearest({ x: 200, y: 0, z: 0 }, 3) === null);

  // Come back to the world: the rows read back and stand again.
  const again = new PlacedProps();
  stood.length = 0;
  await again.enter('tatooine', back, deps);
  ok('coming back stands what was kept', again.all.length === 1 && stood.length === 1 && stood[0] === b!.thing);
  ok('and leaving stands nothing down but forgets it here', (again.leave(), again.all.length === 0 && again.standing === 0));

  // A refusal from the world is not written down.
  const refuse = { stand: async () => false, clear: () => undefined };
  const p2 = new PlacedProps();
  await p2.enter('naboo', { get: () => null }, deps);
  const no = await p2.put('chair', { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], false, refuse, save);
  ok('a thing the world will not stand is not kept', no === null && p2.all.length === 0 && !!p2.note);

  // The cap.
  const p3 = new PlacedProps();
  await p3.enter('naboo', { get: () => null }, deps);
  for (let i = 0; i < PLACED_TUNE.most; i++) await p3.put('chair', { x: i, y: 0, z: 0 }, [0, 0, 0, 1], false, deps, save, i + 1, () => i / PLACED_TUNE.most);
  ok('the cap is reached', p3.all.length === PLACED_TUNE.most);
  const over = await p3.put('chair', { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], false, deps, save);
  ok('and nothing goes past it, with a reason', over === null && p3.note.includes(String(PLACED_TUNE.most)), p3.note);

  // A world nobody has entered takes nothing, which is what an arrival that failed leaves behind.
  const p4 = new PlacedProps();
  ok('nothing may be put down with no world', (await p4.put('chair', { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], false, deps, save)) === null);

  // Rows handed in from somewhere else (a server) replace the browser's own without standing them.
  const p5 = new PlacedProps();
  p5.adopt('naboo', [{ thing: 't', id: 'chair', x: 0, y: 0, z: 0, q: [0, 0, 0, 1] }]);
  ok('rows from elsewhere are taken as they stand', p5.all.length === 1 && p5.all[0].thing === 't');
  ok('and are a copy, so nobody else\'s list moves under us', p5.all[0] !== undefined);
}

await store();

// ---- Picked up, then put back, put away, or carried off on a travel -----------------------------------
//
// The fix round's item: a prop picked up (J) could only ever be put down again or put back where it
// stood (Escape), so there was no way to get rid of one; and a prop held through a travel was put back
// by a stand that waited on a model load and landed in a world that had gone, after the pick-up had
// already taken its row out of the store -- the thing was lost. `restore` is the put-back: the same
// thing, written down before anything is awaited.

async function pickedUp(): Promise<void> {
  let saved: PlacedProp[] = [];
  const save = (_w: string, rows: readonly PlacedProp[]) => void (saved = rows.map((r) => ({ ...r })));
  const store = { get: () => JSON.stringify(saved) };
  const cleared: string[] = [];
  const stood: string[] = [];
  const deps = {
    stand: async (r: PlacedProp) => {
      stood.push(r.thing);
      return true;
    },
    clear: (t: string) => void cleared.push(t),
  };
  const p = new PlacedProps();
  await p.enter('tatooine', { get: () => null }, deps);
  const chair = await p.put('chair', { x: 1, y: 0, z: 2 }, [0, 0, 0, 1], false, deps, save, 5, () => 0.25);
  ok('a chair is down and written', !!chair && saved.length === 1);

  // Picked up, then Escape: the very same thing back where it stood, under its own id.
  const row = p.take(chair!.thing, deps, save)!;
  ok('picking it up takes it out of the store', saved.length === 0 && p.all.length === 0);
  const back = await p.restore(row, deps, save);
  ok('put back, it stands again', back && p.standing === 1);
  ok('as the same thing, not a new one minted', p.all.length === 1 && p.all[0].thing === chair!.thing && saved[0]?.thing === chair!.thing);
  ok('where it stood', p.all[0].x === 1 && p.all[0].z === 2);
  const again = await p.restore(row, deps, save);
  ok('putting back a row that is already back writes nothing twice', again && p.all.length === 1 && saved.length === 1);

  // Picked up, then put away: nothing is written back, so it is gone from the world and from the store.
  p.take(chair!.thing, deps, save);
  ok('put away, it is in neither the world nor the store', p.all.length === 0 && saved.length === 0 && cleared.includes(chair!.thing));

  // Picked up and held through a travel. The stand never answers (the world goes before the model
  // loads): the row must be in the store in the same breath as the call, not after the stand.
  const lamp = await p.put('lamp', { x: 4, y: 0, z: 4 }, [0, 0, 0, 1], true, deps, save, 9, () => 0.5);
  const held = p.take(lamp!.thing, deps, save)!;
  ok('the lamp is out of the store while it is in hand', saved.length === 0);
  let answered = false;
  const never = { stand: () => new Promise<boolean>(() => undefined), clear: () => undefined };
  void p.restore(held, never, save).then(() => (answered = true));
  ok('put back with a stand that never lands, it is written down at once', saved.length === 1 && saved[0].thing === lamp!.thing);
  ok('and kept that it went down indoors', saved[0].inside === true);
  ok('while the stand is still out', !answered);

  // The travel's own call: written and not stood, since the world is going.
  const p2 = new PlacedProps();
  saved = [];
  await p2.enter('naboo', { get: () => null }, deps);
  const crate = await p2.put('crate', { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], false, deps, save, 11, () => 0.75);
  const inHand = p2.take(crate!.thing, deps, save)!;
  stood.length = 0;
  const up = await p2.restore(inHand, deps, save, false);
  ok('kept on a travel: written, not stood', !up && stood.length === 0 && saved.length === 1);
  p2.leave();
  const p3 = new PlacedProps();
  await p3.enter('naboo', store, deps);
  ok('and the next visit stands it with everything else, as the same thing', p3.standing === 1 && p3.all[0].thing === crate!.thing);

  // The world changes while the stand is out: the row is kept, and only a stand in the world it was
  // put back into counts as standing.
  const p4 = new PlacedProps();
  saved = [];
  await p4.enter('corellia', { get: () => null }, deps);
  const stool = await p4.put('stool', { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], false, deps, save, 13, () => 0.1);
  const stoolRow = p4.take(stool!.thing, deps, save)!;
  let land: (v: boolean) => void = () => undefined;
  const slow = { stand: () => new Promise<boolean>((r) => (land = r)), clear: () => undefined };
  const pending = p4.restore(stoolRow, slow, save);
  ok('written down before the slow stand', saved.length === 1);
  p4.leave();
  await p4.enter('dantooine', { get: () => null }, deps);
  land(true);
  ok('a stand that lands in a world since left does not count as standing', (await pending) === false && p4.standing === 0);

  // A stand refused: kept, with a reason, rather than lost.
  const p5 = new PlacedProps();
  saved = [];
  await p5.enter('lok', { get: () => null }, deps);
  const rug = await p5.put('rug', { x: 0, y: 0, z: 0 }, [0, 0, 0, 1], false, deps, save, 17, () => 0.2);
  const rugRow = p5.take(rug!.thing, deps, save)!;
  const refused = await p5.restore(rugRow, { stand: async () => false, clear: () => undefined }, save);
  ok('a put-back the world will not stand is kept in the store', !refused && saved.length === 1 && p5.all.length === 1);
  ok('and says why', p5.note.length > 0, p5.note);

  // No world at all: nothing to put it back into, and nothing written anywhere wrong.
  const p6 = new PlacedProps();
  saved = [];
  ok('with no world there is nothing to put it back in', (await p6.restore(rugRow, deps, save)) === false && saved.length === 0);

  // What giving one up does, the game's own choice (`stopPlacingProp` asks `letGoOf`): Put away throws a
  // picked-up prop away and writes nothing back, which is the whole of what makes it a removal.
  ok('put away, a picked-up prop is gone, and nothing is written back', letGoOf('away', true) === 'gone' && letGoOf('away', false) === 'gone');
  ok('Escape puts a picked-up one back where it stood, and a travel writes it back without standing it', letGoOf('back', true) === 'stand' && letGoOf('keep', true) === 'write');
  ok('one taken fresh from the tab has nowhere to go back to', letGoOf('back', false) === 'nothing' && letGoOf('keep', false) === 'nothing');
}

await pickedUp();

// ---- Moved, refused, and a travel in the wait -----------------------------------------------------
//
// A prop picked up and put down somewhere else is let go of before the new spot's stand is awaited.
// If a travel came in that wait, the store is another world's (or none) when the answer lands: the
// new row must not be filed into it, and the picked-up row must go back into its own world's keeping
// rather than the new one's, or be lost when there is no world at all.

async function movedAcrossATravel(): Promise<void> {
  const kept = new Map<string, PlacedProp[]>();
  const save = (w: string, rows: readonly PlacedProp[]) => void kept.set(w, rows.map((r) => ({ ...r })));
  const store = { get: (key: string) => {
    for (const [w, rows] of kept) if (propsKey(w) === key) return JSON.stringify(rows);
    return null;
  } };
  const cleared: string[] = [];
  const deps = { stand: async () => true, clear: (t: string) => void cleared.push(t) };
  const p = new PlacedProps();
  await p.enter('tatooine', store, deps);
  const chair = await p.put('chair', { x: 1, y: 0, z: 1 }, [0, 0, 0, 1], false, deps, save, 21, () => 0.3);
  const row = p.take(chair!.thing, deps, save)!;
  ok('picked up, the chair is out of its world\'s keeping', (kept.get('tatooine') ?? []).length === 0);

  // Put down somewhere new; the stand waits, and a travel to Naboo comes in the wait.
  let land: (v: boolean) => void = () => undefined;
  const slow = { stand: () => new Promise<boolean>((r) => (land = r)), clear: (t: string) => void cleared.push(t) };
  const worldAt = p.inWorld;
  const putting = p.put('chair', { x: 9, y: 0, z: 9 }, [0, 0, 0, 1], false, slow, save, 22, () => 0.6);
  p.leave();
  await p.enter('naboo', store, deps);
  land(true);
  const put = await putting;
  ok('a put whose world changed in the wait answers nothing', put === null && p.note.includes('world changed'), p.note);
  ok('and files nothing into the world the store is in now', p.all.length === 0 && (kept.get('naboo') ?? []).length === 0);
  ok('and takes down whatever it stood, should it have stood anywhere', cleared.length > 0);
  ok('the store knows the world has changed under the drop', p.inWorld !== worldAt);
  ok('so the chair is written back into its own world\'s keeping', p.keepIn(worldAt, row, store, save) && (kept.get('tatooine') ?? []).some((r) => r.thing === row.thing));
  ok('as the same thing, where it stood, and not into this world\'s', (kept.get('tatooine') ?? [])[0]?.x === 1 && p.all.length === 0 && (kept.get('naboo') ?? []).length === 0);
  ok('written once however often it is asked', p.keepIn(worldAt, row, store, save) && (kept.get('tatooine') ?? []).length === 1);
  const back = new PlacedProps();
  const stood: string[] = [];
  await back.enter('tatooine', store, { stand: async (r) => (stood.push(r.thing), true), clear: () => undefined });
  ok('and the next visit stands it with everything else', stood.includes(row.thing));
  ok('a row with no world to go to is refused, not written under no name', !p.keepIn('', row, store, save) && !kept.has(''));

  // The wiring: the game keeps the world across the wait and only stands the put-back in that world.
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok('the drop keeps the world it began in across the stand', /const worldAt = placedProps\.inWorld;\s*const row = await placedProps\.put\(/.test(main));
  ok('and puts back in that world only while the store is still in it, else into its own keeping', /else if \(placedProps\.inWorld === worldAt\) void placedProps\.restore\(from,[\s\S]{0,200}else if \(placedProps\.keepIn\(worldAt, from, this\.placedStore\(\), save\)\)/.test(main));
  const gone = /const fate = letGoOf\(how, !!from\);\s*if \(fate === 'gone'\) \{([\s\S]*?)\n\s*\}/.exec(main)?.[1] ?? '';
  ok('giving one up asks letGoOf, and a prop put away returns before anything is put back', /\breturn;\s*$/.test(gone) && !/restore|keepIn/.test(gone));
}

await movedAcrossATravel();

console.log(`props placement: ${checks} checks, ${bad} failed`);
if (bad) process.exit(1);
