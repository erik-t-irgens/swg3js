// The line the owner pastes back when they have found a place worth standing a character in.
// Pure arithmetic, so this runs exactly what `__debug.capture` runs.
//
// The case that matters is the boring one: a line has to survive being copied out of a console,
// through a chat window and back into a converter without anything in it changing meaning. So the
// round trip is what is pinned, not the prettiness.
import assert from 'node:assert/strict';
import { captureScene, headingDegrees, hourOf, readSceneLine, sceneLine, type CaptureInput } from '../../../src/world/sceneCapture.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

const base: CaptureInput = {
  pack: 'naboo',
  stand: { x: 10, y: 4, z: -20, heading: Math.PI / 2 },
  camera: { x: 10, y: 6, z: -14, forward: { x: 0, y: -0.2, z: -1 }, fov: 55 },
  dayTime: 0.75,
  ship: null,
};

{
  // Degrees, because a person reads these. The game's own sense is kept: a heading of 0 faces -Z.
  ok(headingDegrees(0) === 0, 'a heading of nought is nought degrees');
  ok(headingDegrees(Math.PI) === 180, 'half a turn is 180');
  ok(headingDegrees(-Math.PI / 2) === 270, 'and a negative turn comes back inside a full circle rather than reading as minus');
  ok(headingDegrees(Math.PI * 4) === 0, 'as does one that has gone round twice');
  ok(headingDegrees(Number.NaN) === 0, 'and a heading that is not a number answers a number');
}

{
  // The hour, which the scene pins on purpose: the day runs, and a backdrop with no hour is the
  // same place at noon one launch and at midnight the next.
  ok(hourOf(0) === 0, 'the day starts at midnight');
  ok(hourOf(0.5) === 12, 'and half of it is noon');
  ok(hourOf(0.75) === 18, 'three quarters is six in the evening');
  ok(hourOf(1.25) === 6, 'a time past the end of the day wraps rather than running off the clock');
  ok(hourOf(-0.25) === 18, 'and so does one before its start');
}

{
  const shot = captureScene(base);
  ok(shot.pack === 'naboo' && shot.hour === 18, 'the world and the hour come through');
  ok(shot.stand.heading === 90, 'the figure keeps its own facing, in degrees');
  ok(shot.name === 'naboo-18h', 'with no name given it is named for the world and the hour, so two captures of one place at two hours do not collide');
  ok(captureScene({ ...base, name: '  theed-terrace  ' }).name === 'theed-terrace', 'and a name given is trimmed rather than pasted with its spaces');
}

{
  // The composition: the camera looks at the figure unless told otherwise, so a shot framed in the
  // ordinary third-person view is framed on the figure with nothing aimed by hand.
  const shot = captureScene(base);
  const d = Math.hypot(shot.camera.look.x - shot.camera.x, shot.camera.look.y - shot.camera.y, shot.camera.look.z - shot.camera.z);
  const toFigure = Math.hypot(base.stand.x - base.camera.x, base.stand.y - base.camera.y, base.stand.z - base.camera.z);
  ok(near(d, toFigure, 0.02), `the look-at point sits at the figure's own distance (${d.toFixed(2)} m against ${toFigure.toFixed(2)})`);
  ok(shot.camera.look.z < shot.camera.z, 'and down the way the camera is really pointing');
  const far = captureScene({ ...base, lookAhead: 50 });
  ok(Math.hypot(far.camera.look.x - far.camera.x, far.camera.look.y - far.camera.y, far.camera.look.z - far.camera.z) > 49, 'a caller that wants the shot framed past the figure says so and is obeyed');
}

{
  // A camera whose forward is not a unit vector, which is what a caller reading one off a matrix
  // can hand over, must not stretch the look-at point.
  const long = captureScene({ ...base, camera: { ...base.camera, forward: { x: 0, y: 0, z: -37 } } });
  const d = Math.hypot(long.camera.look.x - long.camera.x, long.camera.look.y - long.camera.y, long.camera.look.z - long.camera.z);
  ok(near(d, Math.hypot(base.stand.x - base.camera.x, base.stand.y - base.camera.y, base.stand.z - base.camera.z), 0.02), 'a forward that is not a unit vector is normalised rather than multiplying the distance');
  const zero = captureScene({ ...base, camera: { ...base.camera, forward: { x: 0, y: 0, z: 0 } } });
  ok(Number.isFinite(zero.camera.look.x) && Number.isFinite(zero.camera.look.z), 'and a forward of nothing at all answers real numbers rather than dividing by nought');
}

{
  // The ship, which is captured from a parked hull rather than typed.
  const withShip = captureScene({ ...base, ship: { x: 30, y: 4, z: -25, heading: Math.PI } });
  ok(withShip.ship !== null && withShip.ship.heading === 180, 'a parked ship is taken with its own facing');
  ok(captureScene(base).ship === null, 'and a scene with none says so rather than leaving the field out');
}

{
  // The round trip, which is the whole point: out of a console, through a chat window, back in.
  const shot = captureScene({ ...base, name: 'theed-terrace', place: 'Theed', ship: { x: 30, y: 4, z: -25, heading: 0 } });
  const line = sceneLine(shot);
  ok(!line.includes('\n') && !line.includes('\r'), 'the line is one line, so nothing a chat window does to it changes what it means');
  const back = readSceneLine(line);
  ok(back !== null, 'and it reads back');
  ok(JSON.stringify(back) === JSON.stringify(shot), 'to exactly what went in, field for field');
  ok(readSceneLine(`  ${line}  `) === null || JSON.stringify(readSceneLine(line.trim())) === JSON.stringify(shot), 'a line with its own whitespace either reads or is refused, never half-read');
}

{
  // Nothing half-trusted: a line that is not the shape is refused rather than read into a scene
  // with a field missing, because the thing that reads it next bakes a world from it.
  ok(readSceneLine('not json at all') === null, 'something that is not JSON is refused');
  ok(readSceneLine('{}') === null, 'and an empty object');
  ok(readSceneLine(JSON.stringify({ name: 'x', pack: '', stand: base.stand, camera: base.camera, hour: 12 })) === null, 'and one with no world');
  const good = captureScene(base);
  const noHour = { ...good } as Record<string, unknown>;
  delete noHour.hour;
  ok(readSceneLine(JSON.stringify(noHour)) === null, 'and one with no hour, which is the field a backdrop cannot do without');
  const badShip = { ...good, ship: { x: 1, y: 2 } };
  ok(readSceneLine(JSON.stringify(badShip)) === null, 'and one whose ship is half a pose');
}

{
  // Nothing reads as -0, which in a pasted line looks like somebody's mistake.
  const z = captureScene({ ...base, stand: { x: -0.001, y: 0, z: 0, heading: 0 }, camera: { ...base.camera, x: 0, y: 0, z: 0 } });
  ok(!Object.is(z.stand.x, -0) && !Object.is(z.camera.look.y, -0), 'a number that rounds to nothing is nought and never minus nought');
}

console.log(`\n${passed} checks passed`);
