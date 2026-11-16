// The stairs wave's hand-overs that only the game makes, pinned as text (every behaviour test builds them for itself in
// `stairsWaveBody.ts`, so a line lost from the game alone would pass every one of them):
//  - the player (`src/player/player.ts`): last frame's stairs handed to the classes before the plan; the sampler measuring
//    whenever the hips or the step read it, and the move along the stairs counted after it; the stairs, the distance and
//    the legs' clip's time handed over before the legs; the step's snap put on the clip just before the rig's update; the
//    stride, the clearance, the hold and the stairs handed to the feet just before they step;
//  - another player (`src/net/remotePlayers.ts`): the same measure, their stairs and distance before their legs, the snap
//    after the state, the feet's stride, clearance, hold and stairs before they step;
//  - the rig (`src/player/rig.ts`): the stair cycles made as the stair clips are added;
//  - and the walker the tests run (`stairsWaveBody.ts`) hands the feet and the sampler the very same lines the player does.
//
// Run: node tools/swg/tests/stairsWiring.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const read = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
const lines = (text: string) => text.split('\n').map((l) => l.trim());
/** The index of the first line that is exactly `want` (trimmed) at or after `from`, -1 none. */
const at = (ls: string[], want: string, from = 0) => {
  for (let i = from; i < ls.length; i++) if (ls[i] === want) return i;
  return -1;
};

const player = lines(read('src/player/player.ts'));
{
  const first = at(player, 'this.stairLoco();');
  const plan = at(player, 'const classes = this.loco.plan(lo);');
  ok(first >= 0 && plan > first, `the player hands last frame's stairs to the classes before the plan (lines ${first + 1}, ${plan + 1})`);
  const measure = at(player, "sa.measure = LOCO_TUNE.ik.hips === 'steady' || LOCO_TUNE.stairs.stepRule === 'stairs';");
  const moved = at(player, 'this.stairMoved += mv.x * this.stairSense.ux + mv.z * this.stairSense.uz;', measure);
  ok(measure > plan && moved > measure && moved - measure <= 4, `the sampler measures whenever the hips or the step read it, and the move along the stairs is counted after its step (lines ${measure + 1}, ${moved + 1})`);
  const second = at(player, 'this.stairLoco();', first + 1);
  const handed = at(player, 'this.locoIn.stairMoved = this.stairMoved;', second);
  const zeroed = at(player, 'this.stairMoved = 0;', handed);
  const time = at(player, 'this.locoIn.legTime = stepPick !== null && rig.readTime(stepPick.clip) ? rig.timeOut : Number.NaN;', zeroed);
  const legs = at(player, 'const legs = this.loco.legs(onFeet ? rig : null, this.locoIn, this.jkaMode);', time);
  ok(second > moved && handed === second + 1 && zeroed === handed + 1 && time > zeroed && legs > time, `the stairs, the distance gone along them and the legs' clip's time are handed over before the legs (lines ${second + 1} to ${legs + 1})`);
  const snap = at(player, 'if (legs && this.loco.snap === this.loco.snap) rig.setTime(legs.clip, this.loco.snap);', legs);
  ok(snap > legs && player[snap + 1] === 'rig.update(dt);', `the step's snap is put on the clip just before the rig's update (line ${snap + 1})`);
  const stride = at(player, 'fi.stride = stepping ? this.loco.step.stride : 1;');
  ok(
    stride > 0 && player[stride + 1] === 'fi.clear = stepping ? LOCO_TUNE.stairs.clear : 0;' && player[stride + 2] === "fi.pin = stepping && LOCO_TUNE.stairs.pin === 'sole';" && player[stride + 3] === 'stairFeetOf(this.stairSense, fi);' && player[stride + 4] === 'fi.pivotL = stepping ? this.loco.step.pivotL : 0;' && player[stride + 5] === 'fi.pivotR = stepping ? this.loco.step.pivotR : 0;' && at(player, 'this.feet.step(rig, this.physics.world, room ? this.roomInverse.copy(roomFrame(room)).invert() : null);', stride) > stride,
    `the stride, the clearance, the hold, the stairs and each foot's stride pivot are handed to the feet just before they step (line ${stride + 1})`,
  );
}
{
  const remote = lines(read('src/net/remotePlayers.ts'));
  const measure = at(remote, "sa.measure = LOCO_TUNE.ik.hips === 'steady' || LOCO_TUNE.stairs.stepRule === 'stairs';");
  const frame = at(remote, 'stairFrameOf(r, PEER_IN);', measure);
  ok(measure > 0 && frame > measure, `another player's stairs are measured and handed to their legs (lines ${measure + 1}, ${frame + 1})`);
  const state = at(remote, 'rig.setState(state, r.speed, upper, PEER_LEGS);', frame);
  ok(state > frame && remote.slice(state + 1, state + 4).includes('if (r.loco.snap === r.loco.snap) rig.setTime(legs.clip, r.loco.snap);'), `their step's snap is put on the clip after the state (line ${state + 1})`);
  const stride = at(remote, 'fi.stride = r.loco.stepFacts !== null ? r.loco.step.stride : 1;');
  ok(stride > 0 && remote[stride + 1] === 'fi.clear = r.loco.stepFacts !== null ? LOCO_TUNE.stairs.clear : 0;' && remote[stride + 2] === "fi.pin = r.loco.stepFacts !== null && LOCO_TUNE.stairs.pin === 'sole';" && remote[stride + 3] === 'stairFeetOf(r.stairs, fi);' && remote[stride + 4] === 'fi.pivotL = r.loco.stepFacts !== null ? r.loco.step.pivotL : 0;' && remote[stride + 5] === 'fi.pivotR = r.loco.stepFacts !== null ? r.loco.step.pivotR : 0;', `their feet are handed the stride, the clearance, the hold and the stairs (line ${stride + 1})`);
}
{
  const rig = lines(read('src/player/rig.ts'));
  ok(at(rig, 'if (stairs) this.addStairCycles(stairCyclesFor(clips, this.restSkeleton()));') > 0, `the rig makes the stair cycles as the stair clips are added`);
  const walker = lines(read('tools/swg/tests/stairsWaveBody.ts'));
  ok(at(rig, 'const a = was && !same && was.enabled ? (this.strideOf(was) ?? this.stairStrideOf(was)) : null;') > 0 && at(walker, 'if (startAt === startAt) next.time = startAt;') > 0, `a clip taken over from a stair cycle starts in step with it, in the rig and in the tests' walker alike`);
}
{
  const walker = lines(read('tools/swg/tests/stairsWaveBody.ts'));
  const stride = at(walker, 'fi.stride = stepping ? loco.step.stride : 1;');
  ok(
    stride > 0 && walker[stride + 1] === 'fi.clear = stepping ? LOCO_TUNE.stairs.clear : 0;' && walker[stride + 2] === "fi.pin = stepping && LOCO_TUNE.stairs.pin === 'sole';" && walker[stride + 3] === 'stairFeetOf(sense, fi);' && walker[stride + 4] === 'fi.pivotL = stepping ? loco.step.pivotL : 0;' && walker[stride + 5] === 'fi.pivotR = stepping ? loco.step.pivotR : 0;' && at(walker, "sa.measure = LOCO_TUNE.ik.hips === 'steady' || LOCO_TUNE.stairs.stepRule === 'stairs';") > 0,
    `the tests' walker hands the feet and the sampler the player's own lines`,
  );
}
console.log(`stairsWiring: ${checks} checks passed`);
