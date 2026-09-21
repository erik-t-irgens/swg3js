// The head that looks where you look, without a skeleton: the cone measured from the chest rather
// than from the world, the share between the two joints, the ease that never overshoots, what a
// special move does to it, and the one byte that crosses the wire -- through the browser's own
// packer and through the server's own check, so the two cannot drift apart.
import assert from 'node:assert/strict';
import { HeadLook, LOOK, PITCH_WIRE, chestRelative, coneClampDegrees, easeAngle, lookReport, packPitch, pitchReach, pitchStep, tuneLook, unpackPitch, wrapAngle } from '../../../src/player/lookAt.ts';
import { cleanHeadPitch, COMBAT_WIRE, HEAD_PITCH_BYTE } from '../../../server/combatWire.mjs';
import { cleanState } from '../../../server/wire.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number, what: string) => ok(Math.abs(a - b) <= tol, `${what} (${a.toFixed(4)} vs ${b.toFixed(4)})`);

const DEG = Math.PI / 180;
const deg = (radians: number) => radians / DEG;

// --- angles ------------------------------------------------------------------------------------

near(wrapAngle(0.4), 0.4, 1e-9, 'an angle already inside the half turn is left alone');
near(wrapAngle(Math.PI * 2 - 0.2), -0.2, 1e-9, 'the view three hundred and fifty degrees round is ten degrees the other way');
near(Math.abs(wrapAngle(-Math.PI * 3)), Math.PI, 1e-9, 'and a turn and a half back is half a turn, whichever way round it is named');
near(wrapAngle(Number.NaN), 0, 1e-9, 'a number that is not one reads as straight ahead');

near(coneClampDegrees(0.2, 55), 0.2, 1e-9, 'inside the cone: nothing is taken off');
near(coneClampDegrees(80 * DEG, 55), 55 * DEG, 1e-9, 'outside it: held at the cone');
near(coneClampDegrees(-80 * DEG, 55), -55 * DEG, 1e-9, 'and the same the other way');
near(coneClampDegrees(0.5, 0), 0, 1e-9, 'a cone of nothing is the switch that keeps the head straight');

// --- the clamp is relative to the chest ---------------------------------------------------------

// The whole of the rule, in the case it was written for: the aim correction has turned the spine 40
// degrees toward the crosshair and the view is 60 degrees off the body. The head is asked for what
// is left, which is 20, and never for the 55 the cone would allow from the body's heading.
near(deg(chestRelative(60 * DEG, 40 * DEG, LOOK.yaw)), 20, 1e-6, 'the chest has 40 of the 60: the head is asked for the 20 that are left');
near(deg(chestRelative(60 * DEG, 0, LOOK.yaw)), LOOK.yaw, 1e-6, 'with the spine straight the same view is held at the cone');
near(deg(chestRelative(100 * DEG, 40 * DEG, LOOK.yaw)), LOOK.yaw, 1e-6, 'and past the cone from the chest it is still held at the cone');
near(chestRelative(0.3, 0.3, LOOK.yaw), 0, 1e-9, 'a chest already facing the view asks the head for nothing at all');
// The spine turned further than the view: the head looks back the other way, which is what keeps a
// measured aim correction from leaving the head pointing off the target.
ok(chestRelative(20 * DEG, 50 * DEG, LOOK.yaw) < 0, 'a spine turned past the view turns the head back the other way');
near(deg(chestRelative(-170 * DEG, 170 * DEG, 90)), 20, 1e-6, 'the difference is taken the short way round, not across the whole turn');

// --- the ease -----------------------------------------------------------------------------------

near(easeAngle(0, 1, 6, 1 / 60), 6 / 60, 1e-9, 'the ease moves at the rate it is given');
near(easeAngle(0, 0.05, 6, 1 / 60), 0.05, 1e-9, 'a step that would cover the gap lands exactly on it');
ok(easeAngle(0, 0.05, 6, 1) === 0.05, 'and a frame long enough for ten times the gap never overshoots it');
near(easeAngle(1, 0, 6, 1), 0, 1e-9, 'the way back is the same rate and stops at nothing');
near(easeAngle(0.5, 0.5, 6, 1 / 60), 0.5, 1e-9, 'nothing to do: the angle is left where it is');
near(easeAngle(0.3, 1, 6, 0), 0.3, 1e-9, 'a frame of no length moves nothing');
near(easeAngle(0.3, 1, 0, 1), 0.3, 1e-9, 'and a rate of nothing is the switch that stops the head moving at all');

// --- the two joints -------------------------------------------------------------------------------

{
  const look = new HeadLook();
  // Held at the cone after a second of easing, so the shares are read off a settled head.
  for (let i = 0; i < 120; i++) look.step(80 * DEG, 0, 0, 0, 1 / 60, true);
  near(deg(look.yaw), LOOK.yaw, 1e-6, 'a view outside the cone settles at the cone');
  near(look.neckYaw + look.headYaw, look.yaw, 1e-12, 'the neck and the head between them turn exactly what was asked for');
  near(look.neckYaw / look.yaw, LOOK.neckShare, 1e-12, 'the neck takes its share');
  near(look.headYaw / look.yaw, 1 - LOOK.neckShare, 1e-12, 'and the head the rest, which is twice it');
  ok(look.headYaw > look.neckYaw, 'so the head turns further than the neck: a head swivelling on a still neck is the fault this is for');
  near(look.neckPitch + look.headPitch, look.pitch, 1e-12, 'the tilt is shared by the same rule');
}

{
  // A head of its own: the cone, the rate and the share all come from the one tune the head is
  // holding, and never half from it and half from the shared one. A body given a narrower cone but
  // reading the global's share would take its turn apart by the wrong fractions with no error.
  const look = new HeadLook();
  look.tune = { yaw: 20, pitch: 10, neckShare: 0.5, rate: 6, ride: 0 };
  for (let i = 0; i < 240; i++) look.step(80 * DEG, 80 * DEG, 0, 0, 1 / 60, true);
  near(deg(look.yaw), 20, 1e-6, 'a head with its own tune is held to its own cone');
  near(deg(look.pitch), 10, 1e-6, 'and its own tilt');
  near(look.neckYaw, look.headYaw, 1e-12, 'and splits the turn by its own share, not by the one every other head uses');
  ok(LOOK.neckShare !== 0.5, 'which is a different number from the shared one, or the check above would prove nothing');
}

// --- a special move puts it out ------------------------------------------------------------------

{
  const look = new HeadLook();
  for (let i = 0; i < 120; i++) look.step(40 * DEG, 20 * DEG, 0, 0, 1 / 60, true);
  ok(look.yaw > 0.1 && look.pitch > 0.1, 'the head is following the view');
  ok(look.on, 'and says so');
  // The kata starts: the head eases back rather than being dropped, and is straight within the
  // second the rate promises.
  look.step(40 * DEG, 20 * DEG, 0, 0, 1 / 60, false);
  ok(look.wantedYaw === 0 && look.wantedPitch === 0, 'a move that poses the whole body asks for nothing, whatever the view is doing');
  ok(look.yaw > 0 && look.yaw < 40 * DEG, 'and the turn is eased back rather than dropped in a frame');
  for (let i = 0; i < 120; i++) look.step(40 * DEG, 20 * DEG, 0, 0, 1 / 60, false);
  near(look.yaw, 0, 1e-12, 'a second later the head is straight');
  near(look.pitch, 0, 1e-12, 'and level');
  ok(!look.on, 'and still says so, which is what tells the rig it may forget the whole thing');
  look.step(40 * DEG, 20 * DEG, 0, 0, 1 / 60, true);
  ok(look.yaw > 0, 'and it eases out again when the move is over');
  look.reset();
  ok(look.yaw === 0 && look.pitch === 0 && !look.on && look.wantedPitch === 0, 'reset forgets it outright, for a body that was put somewhere');
}

// --- what crosses: one byte -----------------------------------------------------------------------

ok(packPitch(0) === 128, 'level is the middle of the byte');
near(unpackPitch(128), 0, 1e-12, 'and the middle of the byte is level');
ok(packPitch(0) >= 0 && packPitch(0) <= 255, 'it is a byte');
for (const degrees of [-90, -55.5, -30, -1.4, -0.3, 0, 0.3, 1, 12.75, 30, 61, 89.9]) {
  const back = deg(unpackPitch(packPitch(degrees * DEG)));
  ok(Math.abs(back - degrees) <= pitchStep() / 2 + 1e-9, `${degrees} degrees comes back within half a step (${back.toFixed(2)})`);
}
ok(packPitch(200 * DEG) <= 255 && packPitch(-200 * DEG) >= 0, 'a pitch nobody can hold is held inside the byte rather than wrapping');
ok(deg(unpackPitch(packPitch(200 * DEG))) > 0, 'and it is still a look upward, not a look down the other side');
ok(packPitch(Number.NaN) === 128, 'a number that is not one crosses as level');
ok(unpackPitch(Number.NaN) === 0, 'and reads back as level');
ok(unpackPitch(-40) === unpackPitch(0) && unpackPitch(900) === unpackPitch(255), 'anything outside the byte is held at its ends');
near(pitchReach(), 90, 1e-9, 'the byte reaches the ninety degrees that cover every pitch a view can hold');
near(pitchStep(), 90 / 127, 1e-12, 'and a step is the whole byte spent on that reach, not a number typed in');
ok(pitchStep() < 0.71, 'which is finer than three quarters of a degree');

{
  // The step is the *format* and not a tuning: the receiver decodes with its own copy of it, so one
  // browser that could widen it would misread every peer's head by that ratio. Nothing may move it,
  // and every one of the byte's values must come back as itself through the pair.
  const was = pitchStep();
  tuneLook({ pitchStep: 0.2, reach: 10 } as unknown as Partial<typeof LOOK>);
  near(pitchStep(), was, 1e-12, 'the knob cannot reach the step the wire is packed with');
  ok(!Object.keys(LOOK).includes('pitchStep'), 'and the step is not one of the tuning object\'s names at all');
  ok(Object.isFrozen(PITCH_WIRE), 'the wire format is frozen, so nothing can write to it either');
  let worst = 0;
  for (let b = 1; b <= 255; b++) worst = Math.max(worst, Math.abs(packPitch(unpackPitch(b)) - b));
  ok(worst === 0, `every one of the byte's values comes back as itself (worst ${worst})`);
  ok(packPitch(PITCH_WIRE.reach * DEG) === 255 && packPitch(-PITCH_WIRE.reach * DEG) === 1, 'the reach spends the byte to its ends rather than leaving three quarters of it unused');
}

// --- and the server checks it as it checks everything else -------------------------------------------

{
  const state = (extra: Record<string, unknown>) => cleanState({ p: [1, 2, 3], h: 0.5, ...extra }, 7);
  ok(state({ pt: 200 }).pt === 200, 'a byte is passed on');
  ok(state({ pt: 0 }).pt === 0, 'the bottom of the byte is a real value and not a missing one');
  ok(state({ pt: 128.6 }).pt === 129, 'a fraction is rounded to a byte');
  ok(state({ pt: 9000 }).pt === HEAD_PITCH_BYTE, 'anything above the byte is held at its top');
  ok(HEAD_PITCH_BYTE === 255, 'the byte is a byte');
  ok(!Object.keys(COMBAT_WIRE).includes('pitch'), 'and it is not in the object `--set combat.<name>` writes to: a shape is not a tuning');
  ok(state({ pt: -9000 }).pt === 0, 'and anything below it at its bottom');
  ok(state({ pt: 'up' }).pt === undefined, 'a word is not a pitch and is dropped');
  ok(state({ pt: null }).pt === undefined, 'nor is nothing');
  ok(state({}).pt === undefined, 'a state with no pitch in it (a browser built before this) is not an error');
  ok(state({ pt: 200 }).h === 0.5, 'and the rest of the state is untouched');
  ok(cleanHeadPitch(undefined) === undefined, 'the check itself says nothing about a field that is not there');
}

// --- the knob ----------------------------------------------------------------------------------------

{
  const was = { ...LOOK };
  const report = lookReport({ yaw: 70, ride: 1 }, null);
  ok(report.tune.yaw === 70 && report.tune.ride === 1, 'the console moves what the game reads');
  ok(report.wire.reach === 90, 'and reports the wire beside it, which it cannot move');
  ok(report.head === 'no rig', 'and says so when there is no body to report on');
  tuneLook({ neckShare: 4 });
  ok(LOOK.neckShare === 1, 'a share is a share: more than all of it is all of it');
  tuneLook({ yaw: -20 });
  ok(LOOK.yaw === 0, 'and a cone below nothing is nothing, never a cone turned inside out');
  tuneLook(was);
  ok(LOOK.yaw === was.yaw && LOOK.neckShare === was.neckShare && LOOK.ride === was.ride, 'every number goes back where it was');
  const head = new HeadLook();
  head.step(30 * DEG, 10 * DEG, 0, 0, 1, true);
  const on = lookReport(null, head);
  ok(typeof on.head !== 'string' && on.head.on && on.head.yaw > 0, 'with a body it reports where that head is looking, in degrees');
}

console.log(`${checks} checks passed`);
