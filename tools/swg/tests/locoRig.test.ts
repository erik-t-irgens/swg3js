// The speed classes on the game's own rig (src/player/rig.ts), with the committed pack's clips fitted through the very
// record the game sets: each walking and running clip arrives with its stride; two of them fading keep their left
// feet landing together, at 30, 60 and 144 frames a second, and a rig handed the same clips without their strides does
// not (the control); a clip's rate is the ground speed over its feet's own, at the figure's size; the fitted clips
// stand where the figure's own idle holds its root; and `BodyLoco`'s answers drive it.
//
// `rig.ts` reaches the parts character, which node's type stripping refuses, and names modules without their
// extensions: served a stub and the extensions by the resolve hook `animRig.test.ts` uses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import * as THREE from 'three';

const charStub = 'export class Character { static async load() { throw new Error("no pack in a test"); } }';
const hook = `import { existsSync } from 'node:fs';
export async function resolve(s, c, next) {
  if (s === './character' || s === './character.ts' || s.endsWith('/player/character') || s.endsWith('/player/character.ts')) {
    return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(charStub)}), shortCircuit: true };
  }
  if (s.startsWith('.') && !/\\.[a-z]+$/.test(s) && c.parentURL && existsSync(new URL(s + '.ts', c.parentURL))) return next(s + '.ts', c);
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { CharacterRig, IMPORTED_CLIPS, attachImportedClips } = await import('../../../src/player/rig.ts');
const { MixamoPack } = await import('../../../src/anim/mixamoPack.ts');
const { BodyLoco, newLocoIn } = await import('../../../src/anim/bodyLoco.ts');
const { factsOf, phaseAt, phaseGap, sharedRate } = await import('../../../src/anim/locoPhase.ts');
const { STAIR_IDS, dirOf, locoPick, tableClips } = await import('../../../src/anim/locoTable.ts');
const { LOCO_TUNE_SHIPPED } = await import('../../../src/anim/locoTune.ts');
const { readPackIndex } = await import('../../../src/anim/mxaFile.ts');
const { planFit, skeletonKey } = await import('../../../src/anim/fit.ts');
const { ALIGN_SHIPPED } = await import('../../../src/anim/mixamoMap.ts');
const { repoRoot, targetSkeleton } = await import('./animFixtures.ts');
type Rig = InstanceType<typeof CharacterRig>;
type Tune = typeof LOCO_TUNE_SHIPPED;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const root = repoRoot(import.meta.url);
const packDir = join(root, 'public', 'anims', 'mixamo');
const index = readPackIndex(JSON.parse(readFileSync(join(packDir, 'index.json'), 'utf8')));
if (typeof index === 'string') throw new Error(index);
const row = (id: string) => index.clips.find((c) => c.id === id)!;
const T = (): Tune => JSON.parse(JSON.stringify(LOCO_TUNE_SHIPPED)) as Tune;

const pack = new MixamoPack({
  enabled: () => true,
  index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
  clip: async (file: string) => {
    const b = readFileSync(join(packDir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
  breath: async () => {},
  now: () => performance.now(),
});
const info = console.info;
console.info = () => {};
IMPORTED_CLIPS.provider = (skeleton, label) => pack.clipsFor(skeleton, label);
IMPORTED_CLIPS.strides = (clip) => pack.strideOf(clip);

/** A group holding the made skeleton as bones. */
function bonesOf(): THREE.Group {
  const target = targetSkeleton();
  const group = new THREE.Group();
  const made: THREE.Bone[] = [];
  target.joints.forEach((j) => {
    const b = new THREE.Bone();
    b.name = j.name;
    b.position.fromArray(j.restP);
    b.quaternion.fromArray(j.restQ);
    made.push(b);
    (j.parent < 0 ? group : made[j.parent]).add(b);
  });
  return group;
}
const hold = (name: string, seconds = 1) => new THREE.AnimationClip(name, seconds, [new THREE.QuaternionKeyframeTrack('spine2.quaternion', [0, seconds], [0, 0, 0, 1, 0, 0, 0, 1])]);
/** The game's own clips, as a species pack names them; with `ahead`, an idle that holds the root that far ahead of (and a little under) its bind place. */
function ownClips(ahead = 0): THREE.AnimationClip[] {
  const rest = targetSkeleton().joints.find((j) => j.name === 'root')!.restP;
  // (The idle drifts on a little from its first frame, as a breathing loop does: only its first frame says where it stands.)
  const idle = ahead ? new THREE.AnimationClip('idle', 1, [new THREE.VectorKeyframeTrack('root.position', [0, 1], [rest[0], rest[1] - 0.021, rest[2] + ahead, rest[0] + 0.02, rest[1] - 0.03, rest[2] + ahead + 0.03])]) : hold('idle');
  return [idle, ...['walk', 'run', 'loop_rifle:speed0', 'loop_rifle:speed1', 'loop_rifle:speed2', 'BOTH_RUN2', 'BOTH_WALK2', 'BOTH_STAND2'].map((n) => hold(n))];
}
async function rigWith(ahead = 0, strides = true): Promise<Rig> {
  const rig = CharacterRig.fromCharacter({ group: bonesOf(), clips: ownClips(ahead) } as never);
  if (strides) await attachImportedClips(rig, ahead ? 'anchored' : 'made');
  else rig.addClips(await pack.clipsFor(rig.restSkeleton(), 'made'));
  return rig;
}
const actionOf = (rig: Rig, name: string) => (rig as unknown as { actions: Map<string, THREE.AnimationAction> }).actions.get(name)!;
// The legs' own scale (a stride's speed is the legs', not the hips' height's: `FitPlan.stride`), as the pack's own plan
// for this skeleton has it, and as its report says to a thousandth.
const scaleOf = (rig: Rig) => {
  const stride = planFit(index.bones, rig.restSkeleton(), ALIGN_SHIPPED).stride;
  assert.ok(Math.abs((pack.report() as { fits: { key: string; stride: number }[] }).fits.find((f) => f.key === skeletonKey(rig.restSkeleton()))!.stride - stride) < 6e-4, 'the pack reports the stride its plan has');
  return stride;
};

const rig = await rigWith();
const fitScale = scaleOf(rig);

// ---- the clips arrive with their strides ---------------------------------------------------------------------------------
{
  const names = tableClips().map((id) => `mx_${id}`);
  ok(names.every((n) => rig.has(n)), `a rig's load hands it every clip of the speed classes' table (${names.length}), fitted to its skeleton`);
  const speeds = tableClips().map((id) => [id, rig.clipSpeed(`mx_${id}`)!, row(id).speed * fitScale] as const);
  ok(speeds.every(([, got, want]) => Math.abs(got - want) < 2e-3), `each with the speed its feet were made for, scaled by this skeleton's legs' own lengths (x${fitScale.toFixed(3)}: the jog ${speeds.find((s) => s[0] === 'slow_run')![1].toFixed(2)} m/s)`);
  ok(rig.clipSpeed('mx_falling_idle') === null && rig.clipSpeed('mx_jumping_down') === null && rig.clipSpeed('walk') === null && rig.clipSpeed('mx_nothing') === null, 'a fall, a landing and the game\'s own clips have no stride (the converter\'s manifest speaks for the game\'s, and this rig has none)');
  ok(tableClips().every((id) => rig.readSpeed(`mx_${id}`) && Object.is(rig.speedOut, rig.clipSpeed(`mx_${id}`))) && !rig.readSpeed('mx_falling_idle') && !rig.readSpeed('walk') && !rig.readSpeed('mx_nothing'), 'and the same asked the frame\'s way (the speed written into the rig\'s own field, the answer whether it is known) is the same speed to the bit');
  rig.root.scale.setScalar(1.25);
  ok(Math.abs(rig.clipSpeed('mx_slow_run')! - row('slow_run').speed * fitScale * 1.25) < 2e-3, 'and a taller figure\'s feet cover more ground: the speed follows the figure\'s own scale');
  rig.root.scale.setScalar(1);
  ok(rig.stateClip('strafeLeft' as never) === 'mx_jog_strafe_left' && rig.stateClip('strafeRight' as never) === 'mx_jog_strafe_left_mirrored' && rig.tableClip('run' as never) === 'run', 'told only "strafing", a figure plays the jog strafes; every other state\'s own table is as it was');
  rig.prefer('run' as never, 'mx_running');
  ok(rig.stateClip('run' as never) === 'mx_running' && rig.tableClip('run' as never) === 'run', 'a state asked for a clip by name plays it, and its own table is still there under the preference');
  rig.prefer('run' as never, null);
  // A preference let go of while its state stays in force: the clip it had asked for plays on, as it always did (a
  // stance's, a crouch's), unless the rig is told to pick again, which is what the speed classes do when they let go
  // of the legs (the classes switched off on the move; another player's legs let go of while they still run).
  rig.prefer('run' as never, 'mx_running');
  rig.setState('run' as never, 3);
  rig.update(1 / 60);
  rig.prefer('run' as never, null);
  rig.setState('run' as never, 3);
  ok(rig.describe().clip === 'mx_running', 'a preference merely taken off leaves its clip playing while the state stays the same, as before the classes');
  rig.prefer('run' as never, 'mx_running');
  rig.setState('run' as never, 3);
  rig.prefer('run' as never, null, true);
  rig.setState('run' as never, 3);
  ok(rig.describe().clip === 'run' && rig.describe().state === 'run', 'taken off with the word to pick again, the state plays its own clip at its next asking: the game\'s run, not the imported one left racing');
  rig.update(1 / 60);
  rig.setState('run' as never, 3);
  ok(rig.describe().clip === 'run', 'once, and no more');
  rig.prefer('walk' as never, 'mx_standard_walk');
  rig.prefer('walk' as never, null, true);
  rig.setState('run' as never, 3);
  rig.prefer('run' as never, 'mx_running');
  rig.setState('run' as never, 3);
  ok(rig.describe().clip === 'mx_running', 'and a preference taken off a state that is not the one in force changes nothing of the one that is');
  rig.prefer('run' as never, null, true);
  rig.setState('idle' as never);
  rig.update(0.3);
}

// ---- two clips fading keep their feet in step ------------------------------------------------------------------------------
/** Play `from` on `run` at its own rate, then ask for `to`, stepping at a frame rate; the widest the two left feet's landings come apart over the fade. */
function fadeGap(r: Rig, from: string, to: string, fps: number, fade: number, lead = 0.37): { worst: number; frames: number; endRate: number; started: number } {
  const dt = 1 / fps;
  const a = factsOf(row(from), fitScale)!, b = factsOf(row(to), fitScale)!;
  r.setState('idle' as never);
  r.update(dt);
  r.prefer('run' as never, `mx_${from}`);
  for (let t = 0; t < 0.6 + lead; t += dt) {
    r.setState('run' as never, 0, null, { rate: 1, fade });
    r.update(dt);
  }
  r.prefer('run' as never, `mx_${to}`);
  const out = actionOf(r, `mx_${from}`), inn = actionOf(r, `mx_${to}`);
  let worst = 0, frames = 0, started = -1;
  for (let t = 0; t < fade - 1e-9; t += dt) {
    r.setState('run' as never, 0, null, { rate: 1.3, fade });
    if (started < 0) started = phaseGap(phaseAt(out.time, a), phaseAt(inn.time, b));
    r.update(dt);
    if (out.getEffectiveWeight() > 0.02 && inn.getEffectiveWeight() > 0.02) {
      worst = Math.max(worst, phaseGap(phaseAt(out.time, a), phaseAt(inn.time, b)));
      frames++;
    }
  }
  for (let i = 0; i < 3; i++) {
    r.setState('run' as never, 0, null, { rate: 1.3, fade });
    r.update(dt);
  }
  r.prefer('run' as never, null);
  return { worst, frames, endRate: inn.timeScale, started };
}
{
  const pairs: [string, string][] = [['slow_run', 'running'], ['running', 'fast_run'], ['standard_walk', 'slow_run'], ['slow_run', 'drunk_run_forward'], ['drunk_run_forward', 'slow_run'], ['jog_strafe_left', 'left_strafe'], ['slow_run', 'jog_forward_diagonal'], ['jog_backward', 'running_backward'], ['fast_run', 'standard_walk']];
  let worst = 0, n = 0;
  const per: string[] = [];
  for (const fps of [30, 60, 144]) {
    let w = 0;
    for (const [from, to] of pairs) {
      for (const lead of [0.11, 0.37, 0.52]) {
        const g = fadeGap(rig, from, to, fps, 0.2, lead);
        assert.ok(g.frames >= 3, `${from} to ${to} at ${fps}: the fade was seen (${g.frames} frames)`);
        assert.ok(Math.abs(g.endRate - 1.3) < 1e-9, `${from} to ${to}: after the fade the clip plays at its own rate (${g.endRate})`);
        w = Math.max(w, g.worst);
        n++;
      }
    }
    per.push(`${fps} fps ${w.toFixed(4)}`);
    worst = Math.max(worst, w);
  }
  ok(worst < 0.03, `two walking or running clips fading into each other keep their left feet's landings within 0.03 of a stride all the way through, at 30, 60 and 144 frames a second (${n} fades over ${pairs.length} pairs; the widest ${per.join(', ')})`);

  // The control: the same clips handed over without their strides fade plain, from the incoming clip's start, and
  // the same measure sees the feet come apart. So the check above can fail.
  const plain = await rigWith(0, false);
  let apart = 0;
  for (const [from, to] of pairs) for (const lead of [0.11, 0.37, 0.52]) apart = Math.max(apart, fadeGap(plain, from, to, 60, 0.2, lead).worst);
  ok(apart > 0.2, `a rig handed the same clips without their strides fades them from their starts, and the same measure sees the landings up to ${apart.toFixed(2)} of a stride apart`);

  // The rates: the shared rate runs from the outgoing clip's own to the incoming one's.
  const a = factsOf(row('slow_run'), fitScale)!, b = factsOf(row('running'), fitScale)!;
  rig.setState('idle' as never);
  rig.update(1 / 60);
  rig.prefer('run' as never, 'mx_slow_run');
  for (let i = 0; i < 30; i++) {
    rig.setState('run' as never, 0, null, { rate: 0.8, fade: 0.2 });
    rig.update(1 / 60);
  }
  rig.prefer('run' as never, 'mx_running');
  const out = actionOf(rig, 'mx_slow_run'), inn = actionOf(rig, 'mx_running');
  rig.setState('run' as never, 0, null, { rate: 1.4, fade: 0.2 });
  const before = [out.time, inn.time];
  rig.update(1 / 60);
  const dOut = (out.time - before[0]) / a.cycle, dIn = (inn.time - before[1]) / b.cycle;
  const first = dIn * 60;
  ok(Math.abs(dOut - dIn) < 1e-9 && first > 0.8 / a.cycle - 1e-6 && first < 1.4 / b.cycle, `in a frame of the fade both clips go on by the same share of a stride (${dIn.toFixed(5)}), at a rate between the outgoing clip's own (${(0.8 / a.cycle).toFixed(2)} strides a second) and the incoming one's (${(1.4 / b.cycle).toFixed(2)})`);
  // Exactly: the outgoing clip's own rate as the fade began (it was playing at 0.8 of its rate, not at 1), eased to
  // the incoming clip's at the rate asked, by how far through the fade the frame is.
  const w1 = 1 / 60 / 0.2;
  ok(Math.abs(first - sharedRate(0.8 / a.cycle, 1.4 / b.cycle, w1)) < 1e-9 && Math.abs(first - 0.8 / a.cycle) < Math.abs(first - 1.4 / b.cycle) && Math.abs(first - 0.8 / a.cycle) < 0.1 * (0.8 / a.cycle), `the first frame's shared rate is within a tenth of the outgoing clip's own, playing as it was at 0.8 of its rate (${first.toFixed(4)} against ${(0.8 / a.cycle).toFixed(4)} strides a second), and nearer it than the incoming one's`);
  // A rate asked part way through goes to the fade's end and never straight onto the clip.
  rig.setState('run' as never, 0, null, { rate: 0.9, fade: 0.2 });
  const beforeMid = [out.time, inn.time];
  const tsBefore = inn.timeScale;
  rig.update(1 / 60);
  const midRate = ((inn.time - beforeMid[1]) / b.cycle) * 60;
  ok(inn.timeScale !== 0.9 && tsBefore !== 0.9 && Math.abs(midRate - sharedRate(0.8 / a.cycle, 0.9 / b.cycle, 2 * w1)) < 1e-9 && Math.abs((out.time - beforeMid[0]) / a.cycle - (inn.time - beforeMid[1]) / b.cycle) < 1e-9, 'a rate asked part way through a fade is where the shared rate ends, not written onto the incoming clip at once: the two still go on by one share of a stride');
  for (let i = 0; i < 3; i++) {
    rig.setState('run' as never, 0, null, { rate: 1.4, fade: 0.2 });
    rig.update(1 / 60);
  }
  const lastShared = sharedRate(0.8 / a.cycle, 1.4 / b.cycle, 5 * w1);
  ok(Math.abs(inn.timeScale / b.cycle - lastShared) < 1e-9 && lastShared > first, 'and frame by frame it climbs toward the incoming clip\'s own');
  const mid = rig.strideNow();
  ok(mid.fading !== null && mid.fading.from === 'mx_slow_run' && mid.fading.to === 'mx_running' && phaseGap(mid.fading.phase, mid.fading.toPhase) < 0.03, 'and the console\'s account names the two and their phases while they fade');
  for (let i = 0; i < 20; i++) {
    rig.setState('run' as never, 0, null, { rate: 1.4, fade: 0.2 });
    rig.update(1 / 60);
  }
  ok(rig.strideNow().fading === null && Math.abs(inn.timeScale - 1.4) < 1e-12 && rig.strideNow().phase !== null, 'the fade over, the clip plays at the rate asked');

  // A whole-body one-off taking the body in the middle of a fade ends the fade's bookkeeping: the two clips are not
  // written to under it.
  rig.prefer('run' as never, 'mx_slow_run');
  rig.setState('run' as never, 0, null, { rate: 1, fade: 0.2 });
  rig.update(1 / 60);
  ok(rig.strideNow().fading !== null, 'a fade in step under way');
  rig.play('BOTH_STAND2', { fadeIn: 0.05 });
  rig.update(1 / 60);
  ok(rig.strideNow().fading === null, 'a whole-body one-off ends it at once');
  // The legs' clip fades out under the one-off and goes dead. The one-off then moved onto the upper body alone (a
  // swing split off running legs), the legs' clip comes back as its lower half: plain, from its start, since a clip
  // gone dead hands no phase on (its time is wherever it happened to die).
  for (let i = 0; i < 12; i++) rig.update(1 / 60);
  const dead = actionOf(rig, 'mx_slow_run');
  ok(!dead.enabled && dead.time > 0.05, 'the clip that had the legs has faded out under the one-off and gone dead, part way through its stride');
  rig.overrideUpperOnly();
  const back = rig.strideNow();
  ok(back.clip === 'lower:mx_slow_run' && back.fading === null && Math.abs(back.phase! - phaseAt(0, factsOf(row('slow_run'), fitScale)!)) < 1e-9, 'and its lower half, coming back under a one-off moved to the upper body, starts plain from its own start');
  // The one-off over, the whole clip again; and the state back on the run for what follows.
  for (let i = 0; i < 70; i++) {
    rig.setState('run' as never, 0, null, { rate: 1, fade: 0.2 });
    rig.update(1 / 60);
  }
  rig.prefer('run' as never, 'mx_running');
  for (let i = 0; i < 20; i++) {
    rig.setState('run' as never, 0, null, { rate: 1.4, fade: 0.2 });
    rig.update(1 / 60);
  }
  ok(rig.strideNow().clip === 'mx_running' && rig.strideNow().fading === null && Math.abs(inn.timeScale - 1.4) < 1e-12, 'the one-off over and the fade back done, the run plays whole at the rate asked');

  // The legs under an upper-body pose: the clip's lower half takes over where the whole clip was.
  const p0 = rig.strideNow().phase!;
  rig.setState('run' as never, 0, 'BOTH_STAND2', { rate: 1.4, fade: 0.2 });
  const half = rig.strideNow();
  ok(half.clip === 'lower:mx_running' && phaseGap(half.fading ? half.fading.toPhase : half.phase!, p0) < 1e-6, 'a pose taking the upper body leaves the legs where they were in their stride: the lower half starts at the whole clip\'s phase');
  rig.setState('idle' as never);
  rig.update(0.3);
  rig.prefer('run' as never, null);
  // From a clip with no stride (the idle, a Jedi Academy run) a striding clip fades in plain, from its start.
  rig.prefer('run' as never, 'mx_slow_run');
  rig.setState('run' as never, 0, null, { rate: 1, fade: 0.2 });
  ok(actionOf(rig, 'mx_slow_run').time === 0 && rig.strideNow().fading === null, 'from a clip with no stride (the idle) a walk fades in plain, from its start');
  rig.prefer('run' as never, null);
  // The stairs wave: off a whole stair cycle (its two footfalls, the left foot's among them), a walk starts in step, its
  // left foot's landing at the cycle's; onto a stair cycle nothing is put in step (the stairs' step starts it itself).
  const cyc = 'mx_ascending_stairs~trimmed';
  const stairPack = new MixamoPack({
    enabled: () => true,
    index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
    clip: async (file: string) => {
      const b = readFileSync(join(packDir, file));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    breath: async () => {},
    also: [...STAIR_IDS],
    now: () => performance.now(),
  });
  const sr = CharacterRig.fromCharacter({ group: bonesOf(), clips: ownClips() } as never);
  sr.addClips(await stairPack.clipsFor(sr.restSkeleton(), 'made'), (c: THREE.AnimationClip) => stairPack.strideOf(c));
  const sf = sr.stairFacts(cyc);
  if (sf && sr.has(cyc)) {
    const k = sf.side[0] === 0 ? 0 : 1;
    sr.prefer('walk' as never, 'mx_standard_walk');
    sr.setState('walk' as never, 0, null, { rate: 1, fade: 0.2 });
    sr.update(0.5);
    sr.prefer('walk' as never, cyc);
    sr.setState('walk' as never, 0, null, { rate: 1, fade: 0.2 });
    ok(actionOf(sr, cyc).time === 0 && sr.strideNow().fading === null, 'onto a stair cycle the clip starts plain, from its start (the stairs\' step puts it where it lands)');
    sr.update(0.2);
    sr.update(0.31);
    const t = actionOf(sr, cyc).time;
    sr.prefer('walk' as never, 'mx_standard_walk');
    sr.setState('walk' as never, 0, null, { rate: 1, fade: 0.2 });
    const want = (((t - sf.at[k]) / sf.len) % 1 + 1) % 1;
    const got = phaseAt(actionOf(sr, 'mx_standard_walk').time, factsOf(row('standard_walk'), fitScale)!);
    ok(phaseGap(got, want) < 1e-6 && sr.strideNow().fading !== null, `off the stair cycle the walk starts in step: its phase ${got.toFixed(3)}, the cycle's ${want.toFixed(3)} (from its left foot's landing)`);
    sr.prefer('walk' as never, null);
    sr.setState('idle' as never);
    sr.update(0.3);
  } else ok(false, 'the test rig holds the stair cycle it is asked about');
}

// ---- the rate a clip plays at ---------------------------------------------------------------------------------------------
{
  const natural = rig.clipSpeed('mx_slow_run')!;
  rig.setState('idle' as never);
  rig.update(0.3);
  rig.prefer('run' as never, 'mx_slow_run');
  rig.setState('run' as never, natural * 1.2);
  ok(Math.abs(actionOf(rig, 'mx_slow_run').timeScale - 1.2) < 1e-9, 'with no rate handed in, a striding clip plays at the body\'s speed over its feet\'s own, as the game\'s clips do by their manifest');
  rig.setState('run' as never, natural * 9);
  ok(actionOf(rig, 'mx_slow_run').timeScale === 2.5, 'inside the game\'s own band');
  rig.setState('run' as never, natural * 9, null, { rate: 0.7 });
  ok(actionOf(rig, 'mx_slow_run').timeScale === 0.7, 'and at the rate handed in when one is (the speed classes work theirs out inside their own band)');
  rig.prefer('run' as never, null);
  // `BodyLoco` over this rig: the legs' clip and its rate for a frame.
  const tune = T();
  const body = new BodyLoco(tune);
  const f = newLocoIn();
  f.dt = 1 / 60;
  f.sprint = tune.speed.forward.sprint;
  f.pool = tune.stamina.pool;
  ok(body.enabled(rig), 'the body has the classes on this rig: the switch is on and the rig has every clip');
  body.keys(1 / 60, false, false, false, rig);
  f.mz = 1;
  ok(body.plan(f) && body.pick!.id === 'slow_run' && body.speed === tune.speed.forward.jog, 'forward with nothing held is the jog');
  const at = (ground: number) => ((f.ground = ground), f);
  const legs = body.legs(rig, at(2.85), false);
  ok(legs !== null && legs.clip === 'mx_slow_run' && Math.abs(body.rate - 2.85 / natural) < 1e-9 && body.legsOn, `its legs are the slow run, at the ground speed over the clip's own on this figure (${body.rate.toFixed(3)})`);
  rig.root.scale.setScalar(1.25);
  body.legs(rig, at(2.85), false);
  ok(Math.abs(body.rate - 2.85 / (natural * 1.25)) < 1e-9, 'a taller figure\'s clip plays slower for the same ground: the rate follows the figure\'s own scale');
  rig.root.scale.setScalar(1);
  body.legs(rig, at(0.4), false);
  ok(body.rate === tune.rate.min, 'held to the band\'s least while the body gathers speed');
  body.legs(rig, at(30), false);
  ok(body.rate === tune.rate.max, 'and its most');
  f.boost = 2;
  body.plan(f);
  body.legs(rig, at(30), false);
  ok(body.rate === tune.rate.max * 2, 'which Force Speed\'s own factor raises');
  ok(body.legs(rig, at(2.85), true) === null && !body.legsOn && body.legs(null, at(2.85), false) === null, 'with Jedi Academy\'s animations in charge, or no rig, the legs are the caller\'s own');
  const bare = CharacterRig.fromCharacter({ group: bonesOf(), clips: ownClips() } as never);
  ok(!body.enabled(bare) && !new BodyLoco(tune).enabled(null), 'a rig without the imported clips has no classes');
  const partial = CharacterRig.fromCharacter({ group: bonesOf(), clips: ownClips() } as never);
  partial.addClips([actionOf(rig, 'mx_slow_run').getClip(), actionOf(rig, 'mx_running').getClip()]);
  ok(!body.enabled(partial), 'nor one with only some of them');
}

// ---- the fitted clips stand where the figure's own idle holds the root --------------------------------------------------
{
  const anchored = await rigWith(0.055);
  const skeleton = anchored.restSkeleton();
  ok(!!skeleton.anchor && Math.abs(skeleton.anchor[2] - 0.055) < 1e-6 && Math.abs(skeleton.anchor[1] + 0.021) < 1e-6 && rig.restSkeleton().anchor === undefined, 'a rig says where its own idle holds the root (5.5 cm ahead of the bind pose and 2 cm under it here); one whose idle leaves it at rest says nothing');
  ok(skeletonKey(skeleton) !== skeletonKey(rig.restSkeleton()), 'and that is a fit of its own');
  const rootTrack = (r: Rig, name: string) => actionOf(r, name).getClip().tracks.find((t) => t.name === 'root.position')!.values as Float32Array;
  let worstLevel = 0, worstHeight = 0;
  for (const id of [...tableClips(), 'falling_idle', 'treading_water', 'jumping_up', 'hard_landing']) {
    const a = rootTrack(anchored, `mx_${id}`), b = rootTrack(rig, `mx_${id}`);
    for (let i = 0; i < a.length; i += 3) {
      worstLevel = Math.max(worstLevel, Math.abs(a[i] - b[i]), Math.abs(a[i + 2] - b[i + 2] - 0.055));
      worstHeight = Math.max(worstHeight, Math.abs(a[i + 1] - b[i + 1]));
    }
  }
  ok(worstLevel < 1e-6 && worstHeight < 1e-6, 'every clip fitted to it holds the hips that far ahead, frame for frame, and at the very height it had: level with the idle, the clip\'s own rise and fall untouched');
  // So a hand-over from the idle to a walk does not slide the hips: the walk's mean place is the idle's, level.
  const walk = rootTrack(anchored, 'mx_standard_walk');
  const rest = targetSkeleton().joints.find((j) => j.name === 'root')!.restP;
  let mz = 0, mx = 0;
  for (let i = 0; i < walk.length; i += 3) {
    mx += walk[i] / (walk.length / 3);
    mz += walk[i + 2] / (walk.length / 3);
  }
  const unanchored = rootTrack(rig, 'mx_standard_walk');
  let uz = 0;
  for (let i = 0; i < unanchored.length; i += 3) uz += unanchored[i + 2] / (unanchored.length / 3);
  // The walk leans a little ahead of its own source's hips (its pose, kept); what the anchor moves is where that is counted from.
  const lean = uz - rest[2];
  ok(Math.abs(mz - uz - 0.055) < 1e-6 && Math.abs(mx - rest[0]) < 0.02 && Math.abs(lean) < 0.06, `the walk's hips ride ${(lean * 100).toFixed(1)} cm ahead of where its source's stood, as the clip was made; counted from the bind pose's place without the anchor, and from where the idle stands with it (${((mz - rest[2]) * 100).toFixed(1)} cm ahead of the bind pose): the 5.5 cm slide at every hand-over is gone`);
}

// ---- the hold that keeps an upper-body pose steady over moving legs comes on and goes over a fade ------------------------
// The hold takes the pelvis's whole turn off the lowest spine bone, and a strafe's hips stand turned: on at once (as
// it always was, and still is with no ease asked) it turns the torso that far in the one frame the legs start or stop.
{
  const restRoot = new THREE.Quaternion().fromArray(targetSkeleton().joints.find((j) => j.name === 'root')!.restQ);
  const boneOf = (r: Rig, name: string) => {
    let found: THREE.Bone | null = null;
    (r as unknown as { root: THREE.Object3D }).root.traverse((o) => {
      if (o.name === name) found = o as THREE.Bone;
    });
    return found! as THREE.Bone;
  };
  /** Two rigs driven alike, one with the hold and one without: what the hold put on the lowest spine bone, as a share of the whole turn. */
  const drive = async (ease: number, fps: number) => {
    const held = await rigWith();
    const plain = await rigWith();
    plain.steady = false;
    held.steadyEase = ease;
    const rows: { share: number; step: number; full: number }[] = [];
    let was = new THREE.Quaternion();
    let first = true;
    const frame = (state: string, upper: string | null) => {
      for (const r of [held, plain]) {
        r.prefer('run' as never, 'mx_jog_strafe_left');
        r.setState(state as never, 0, upper, { rate: 1, fade: 0.2 });
        r.update(1 / fps);
        (r as unknown as { root: THREE.Object3D }).root.updateMatrixWorld(true);
        r.twistTorso(0, 0);
      }
      const root = boneOf(held, 'root');
      const full = root.quaternion.clone().invert().multiply(restRoot);
      // What the hold put on: the held rig's spine against the plain one's, the same clip at the same time.
      const put = boneOf(held, 'spine1').quaternion.clone().multiply(boneOf(plain, 'spine1').quaternion.clone().invert());
      const whole = 2 * Math.acos(Math.min(1, Math.abs(full.w)));
      const share = whole > 1e-6 ? (2 * Math.acos(Math.min(1, Math.abs(put.w)))) / whole : 0;
      const world = boneOf(held, 'spine1').getWorldQuaternion(new THREE.Quaternion());
      rows.push({ share, step: first ? 0 : world.angleTo(was), full: whole });
      was = world;
      first = false;
    };
    const n = Math.round(0.5 * fps);
    for (let i = 0; i < n; i++) frame('idle', 'BOTH_STAND2');
    const start = rows.length;
    for (let i = 0; i < n; i++) frame('run', 'BOTH_STAND2');
    const stop = rows.length;
    for (let i = 0; i < n; i++) frame('idle', 'BOTH_STAND2');
    return { rows, start, stop, n };
  };
  const once = await drive(0, 60);
  ok(once.rows.slice(0, once.start).every((r) => r.share < 1e-5), 'standing under a pose the hold puts nothing on the spine');
  ok(Math.abs(once.rows[once.start].share - 1) < 1e-6 && once.rows.slice(once.start, once.stop).every((r) => Math.abs(r.share - 1) < 1e-6), 'with no ease asked the hold is whole on the first frame the legs move, as it always was');
  ok(once.rows[once.stop].share < 1e-5, 'and gone on the first frame they stop');
  const turned = once.rows[once.stop - 1].full;
  ok(turned > 0.1, `(the strafe's hips stand turned ${((turned * 180) / Math.PI).toFixed(1)} degrees from their rest as the legs stop)`);
  ok(once.rows[once.stop].step > 0.6 * turned, `so at once the torso turns ${((once.rows[once.stop].step * 180) / Math.PI).toFixed(1)} degrees in the one frame the legs stop`);
  for (const fps of [30, 60, 144]) {
    const eased = await drive(0.2, fps);
    const at = (seconds: number, from: number) => eased.rows[from + Math.round(seconds * fps) - 1].share;
    ok(Math.abs(at(0.1, eased.start) - 0.5) < 0.02 + 0.5 / (0.2 * fps) && Math.abs(at(0.2, eased.start) - 1) < 1e-5 && Math.abs(at(0.4, eased.start) - 1) < 1e-5, `${fps} fps, eased over 0.2 s: half on a tenth of a second after the legs start, whole at a fifth and after`);
    ok(Math.abs(at(0.1, eased.stop) - 0.5) < 0.02 + 0.5 / (0.2 * fps) && at(0.2, eased.stop) < 1e-5 && at(0.4, eased.stop) < 1e-5, `${fps} fps: half gone a tenth of a second after they stop, none at a fifth and after`);
    let worst = 0;
    for (let i = eased.start; i < eased.rows.length; i++) worst = Math.max(worst, Math.abs(eased.rows[i].share - eased.rows[i - 1].share));
    ok(worst < 1 / (0.2 * fps) + 1e-3, `${fps} fps: the share never moves more than a frame's part of the ease (${worst.toFixed(3)} a frame)`);
    ok(eased.rows[eased.stop].step < 0.35 * once.rows[once.stop].step * (60 / fps) + 0.01, `${fps} fps: the torso turns ${((eased.rows[eased.stop].step * 180) / Math.PI).toFixed(1)} degrees in the frame the legs stop, where at once it turned ${((once.rows[once.stop].step * 180) / Math.PI).toFixed(1)}`);
  }
  // The pose let go of while the hold eases out: nothing is left to hold, and nothing is put on.
  {
    const r = await rigWith();
    r.steadyEase = 0.2;
    const step = (state: string, upper: string | null) => {
      r.prefer('run' as never, 'mx_jog_strafe_left');
      r.setState(state as never, 0, upper, { rate: 1, fade: 0.2 });
      r.update(1 / 60);
      (r as unknown as { root: THREE.Object3D }).root.updateMatrixWorld(true);
      r.twistTorso(0, 0);
    };
    for (let i = 0; i < 30; i++) step('run', 'BOTH_STAND2');
    const twists = (r as unknown as { twists: Map<THREE.Bone, { clean: THREE.Quaternion; twisted: THREE.Quaternion }> }).twists;
    const spine = boneOf(r, 'spine1');
    ok(spine.quaternion.angleTo(twists.get(spine)!.clean) > 0.05, 'moving under a pose, the hold is on the spine');
    step('idle', null);
    ok(spine.quaternion.angleTo(twists.get(spine)!.clean) < 1e-6, 'the pose let go of, the hold puts nothing on, eased or not');
  }
  const src = readFileSync(join(root, 'src/player/player.ts'), 'utf8');
  ok(src.includes('rig.steadyEase = this.loco.on ? LOCO_TUNE.fade.idle : 0;'), "the player eases the hold over the legs' own fade to and from standing while the classes are on, and not at all without them");
}

console.info = info;
console.log(`\n${checks} checks passed`);
