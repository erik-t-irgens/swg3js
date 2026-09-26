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

import { NO_TURN, PROP_TUNE, applyTurn, liftBy, propPoints, propSpot, propVerdict, pushBy, turnBy, type PropBox, type PropTurn } from '../../../src/world/propPlace.ts';
import { PLACED_TUNE, PlacedProps, mintThing, placedTally, propsKey, readRow, type PlacedProp } from '../../../src/world/propsPlaced.ts';

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
  ok('twenty-four presses of fifteen degrees is a full turn', near(back.x, 1, 1e-6) && near(back.y, 2, 1e-6) && near(back.z, 3, 1e-6), `${back.x.toFixed(4)}, ${back.y.toFixed(4)}, ${back.z.toFixed(4)}`);
  ok('a turn key is fifteen degrees', PROP_TUNE.turn === 15);
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

// ---- The wheel and the height keys ---------------------------------------------------------------

{
  ok('the wheel pushes it out a quarter metre a notch', near(pushBy(3, 1), 3.25));
  ok('and stops at the far end', near(pushBy(PROP_TUNE.far, 10), PROP_TUNE.far));
  ok('and at the near end', near(pushBy(PROP_TUNE.near, -10), PROP_TUNE.near));
  ok('a height key is a tenth of a metre', near(liftBy(0, 1), PROP_TUNE.rise));
  ok('and it is kept on the step', near(liftBy(0, 3), 0.3, 1e-9), `${liftBy(0, 3)}`);
  ok('and within thirty metres either way', near(liftBy(0, 100000), PROP_TUNE.most) && near(liftBy(0, -100000), -PROP_TUNE.most));
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

console.log(`props placement: ${checks} checks, ${bad} failed`);
if (bad) process.exit(1);
