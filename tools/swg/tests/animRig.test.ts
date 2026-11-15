// The rig and the imported clips: the game's own CharacterRig (src/player/rig.ts) round a skeleton made here, handed
// the committed pack's clips through the very record the game sets (`IMPORTED_CLIPS`). What every state plays without
// the clips is held to the rig as it stood before this pass (87280ee, out of git, and to a hash recorded from it where
// git cannot answer); with them, only the air and the still water change.
//
// `rig.ts` reaches the parts character, which node's type stripping refuses, and names modules without their
// extensions: served a stub and the extensions by the resolve hook `moods.test.ts` uses.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
const { MX } = await import('../../../src/anim/animRules.ts');
const { BodyAnim } = await import('../../../src/anim/bodyAnim.ts');
const { ANIM_TUNE } = await import('../../../src/anim/animTune.ts');
const { UNIT } = await import('../../../src/player/jkaMove.ts');
const { skeletonKey } = await import('../../../src/anim/fit.ts');
const { repoRoot, targetSkeleton, qangle } = await import('./animFixtures.ts');
type Rig = InstanceType<typeof CharacterRig>;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const root = repoRoot(import.meta.url);
const PRE_PASS = '87280eea4925a4b233068a7f58daf11c47e5fb73';
/** What the rig before this pass answered for the fixtures below, hashed: recorded from that commit's own rig. */
const PRE_PASS_TRACE = '08e28dce5f72';

/** A group holding the made skeleton as bones. */
function bonesOf(target = targetSkeleton()): THREE.Group {
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
/** A clip that holds the root where it rests: enough for the mixer to bind, play and blend it. */
const clip = (name: string, seconds = 1) => new THREE.AnimationClip(name, seconds, [new THREE.QuaternionKeyframeTrack('spine2.quaternion', [0, seconds], [0, 0, 0, 1, 0, 0, 0, 1])]);

/** Three sets of clip names: the placeholder's, a species pack's with the Jedi Academy clips, and one with next to nothing. */
const PACKS: Record<string, string[]> = {
  placeholder: ['idle', 'walk', 'run', 'jump', 'fall', 'swim', 'float', 'sit'],
  species: ['idle', 'loop_stand', 'loop_walk', 'loop_run', 'BOTH_INAIR1', 'BOTH_JUMP1', 'BOTH_LAND1', 'BOTH_STAND2', 'BOTH_RUN2', 'BOTH_WALK2', 'BOTH_CROUCH1IDLE', 'BOTH_CROUCH1WALK', 'loop_swimming:speed0', 'loop_swimming:speed1', 'loop_riding', 'loop_jump', 'sneak_pose', 'idle_combat', 'loop_sitting_ground'],
  bare: ['idle'],
};
const STATES = ['idle', 'walk', 'run', 'air', 'seated', 'swim', 'float', 'crouch', 'crouchWalk', 'crouchWalkBack', 'stance', 'strafeLeft', 'strafeRight', 'runBack', 'walkBack', 'runSaber', 'walkSaber', 'gunIdle', 'gunWalk', 'gunRun', 'gunReadyIdle', 'gunReadyWalk', 'gunReadyRun', 'gunAimIdle', 'gunAimWalk', 'gunAimRun', 'kneel', 'prone', 'proneMove', 'gunProneIdle', 'gunProneMove', 'gunProneReadyIdle', 'gunProneReadyMove', 'gunProneAimIdle', 'gunProneAimMove'];

type RigClass = { fromCharacter(c: never, o?: object): Rig };
/** What every state plays, for every fixture pack: `state` set, a frame stepped, the state's clip read. */
function trace(Class: RigClass, extra: (rig: Rig) => void = () => {}): Record<string, Record<string, string | null>> {
  const out: Record<string, Record<string, string | null>> = {};
  for (const [pack, names] of Object.entries(PACKS)) {
    const rig = Class.fromCharacter({ group: bonesOf(), clips: names.map((n) => clip(n)) } as never);
    extra(rig);
    out[pack] = {};
    for (const s of STATES) {
      rig.setState(s as never, 1);
      rig.update(1 / 60);
      out[pack][s] = `${rig.currentClip}|${rig.hasState(s as never)}|${rig.naturalSpeed(s as never)}`;
    }
  }
  return out;
}
const hashOf = (t: unknown) => createHash('sha1').update(JSON.stringify(t)).digest('hex').slice(0, 12);

// ---- without the clips the rig is the rig before the pass ------------------------------------------------------------------
const plain = trace(CharacterRig);
{
  let old: Record<string, Record<string, string | null>> | null = null;
  let dir = '';
  try {
    const text = execFileSync('git', ['show', `${PRE_PASS}:src/player/rig.ts`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
    dir = mkdtempSync(join(tmpdir(), 'swg3js-rig-'));
    const here = (rel: string) => pathToFileURL(join(root, 'src', 'player', rel)).href;
    // Every relative import at today's file, and three by the address this process already has it at (a second
    // three would break every instanceof).
    const rewritten = text
      .replace(/from '(\.\.?\/[^']+)'/g, (_m, spec: string) => (/\/character$/.test(spec) ? `from './character'` : `from '${here(/\.[a-z]+$/.test(spec) ? spec : `${spec}.ts`)}'`))
      .replace(/from 'three'/g, `from '${import.meta.resolve('three')}'`)
      .replace(/from 'three\/examples\/jsm\/loaders\/GLTFLoader\.js'/g, `from '${import.meta.resolve('three/examples/jsm/loaders/GLTFLoader.js')}'`);
    const file = join(dir, 'rigBefore.ts');
    writeFileSync(file, rewritten);
    const before = (await import(pathToFileURL(file).href)) as { CharacterRig: RigClass };
    old = trace(before.CharacterRig);
  } catch (err) {
    note(`git could not hand over the rig before the pass (${err instanceof Error ? err.message.split('\n')[0] : err}): held to the recorded hash alone`);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  if (old) {
    assert.deepEqual(plain, old);
    ok(true, `a rig with none of the imported clips plays, for all ${STATES.length} states over three kinds of pack, exactly what the rig before the pass played (its own code, out of git)`);
    ok(hashOf(old) === PRE_PASS_TRACE, `and that rig's answers are the ones recorded (${hashOf(old)})`);
  }
  ok(hashOf(plain) === PRE_PASS_TRACE, 'held to the hash recorded from the rig before the pass, with git or without');
  ok(plain.species.air.startsWith('BOTH_INAIR1|') && plain.species.float.startsWith('loop_swimming:speed0|') && plain.placeholder.air.startsWith('jump|') && plain.placeholder.float.startsWith('float|'), 'so the air is the game\'s own in-air pose and the still water its slow swim, as before');
}

// ---- the committed pack through the game's own record ------------------------------------------------------------------------
const packDir = join(root, 'public', 'anims', 'mixamo');
let asked = 0;
const pack = new MixamoPack({
  enabled: () => true,
  index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
  clip: async (file: string) => {
    asked++;
    const b = readFileSync(join(packDir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
  breath: async () => {},
  now: () => performance.now(),
});
const info = console.info;
console.info = () => {};

{
  const rig = CharacterRig.fromCharacter({ group: bonesOf(), clips: PACKS.species.map((n) => clip(n)) } as never);
  const names = rig.clipNames.length;
  await attachImportedClips(rig, 'no provider');
  ok(rig.clipNames.length === names && !rig.has(MX.fall), 'with no provider set a rig\'s load attaches nothing: the rig it was');
  IMPORTED_CLIPS.provider = (skeleton, label) => pack.clipsFor(skeleton, label);
  await attachImportedClips(rig, 'made');
  const used = (pack.report() as { used: string[] }).used;
  ok(used.length >= 10 && used.every((n) => rig.has(n)) && rig.clipNames.length === names + used.length, `through the provider the game sets, the rig has every clip the game uses before its load returns (${used.length})`);

  // Only the air and the still water change.
  const withClips = trace(CharacterRig, (r) => r.addClips(used.map((n) => (rig as unknown as { actions: Map<string, THREE.AnimationAction> }).actions.get(n)!.getClip())));
  const changed: string[] = [];
  for (const p of Object.keys(PACKS)) for (const s of STATES) if (withClips[p][s] !== plain[p][s]) changed.push(`${p}.${s}`);
  ok(changed.sort().join() === ['bare.air', 'bare.float', 'placeholder.air', 'placeholder.float', 'species.air', 'species.float'].join(), `with the clips, of every state only the air and the still water play something else (${changed.length} of ${STATES.length * 3} answers)`);
  ok(withClips.species.air.startsWith(`${MX.fall}|`) && withClips.species.float.startsWith(`${MX.tread}|`), 'the falling loop and the tread');

  // What the player asks for by name.
  const playing = (state: string) => {
    rig.setState(state as never, 0);
    rig.update(1 / 60);
    return rig.currentClip;
  };
  rig.prefer('float', MX.adrift);
  ok(playing('float') === MX.adrift, 'adrift in space the still state is asked for the flying loop, and plays it');
  rig.prefer('float', MX.tread);
  ok(playing('idle') === 'idle' && playing('float') === MX.tread, 'and in the water for the tread again');
  rig.prefer('air', MX.thrown);
  ok(playing('idle') === 'idle' && playing('air') === MX.thrown, 'thrown from a wreck the air is the long fall');
  rig.prefer('air', MX.float);
  ok(playing('idle') === 'idle' && playing('air') === MX.float, 'after a flip or a Force jump the float');
  rig.prefer('air', 'BOTH_INAIR1');
  ok(playing('idle') === 'idle' && playing('air') === 'BOTH_INAIR1', 'and with Jedi Academy\'s animations in charge that game\'s own, though the rig has the imported loop');
  const without = CharacterRig.fromCharacter({ group: bonesOf(), clips: PACKS.species.map((n) => clip(n)) } as never);
  without.prefer('float', MX.tread);
  without.prefer('air', MX.fall);
  without.setState('float' as never);
  const f = without.currentClip;
  without.setState('air' as never);
  ok(f === 'loop_swimming:speed0' && without.currentClip === 'BOTH_INAIR1', 'a rig without the clips asked for them by name plays what it always did');

  // A one-off from its trim.
  const hard = rig.clipDuration(MX.landHard)!;
  const action = (rig as unknown as { actions: Map<string, THREE.AnimationAction> }).actions.get(MX.landHard)!;
  const left = rig.play(MX.landHard, { fadeIn: 0.06, from: 0.533 });
  ok(left !== null && Math.abs(left - (hard - 0.533)) < 1e-9 && Math.abs(action.time - 0.533) < 1e-9 && rig.overrideName === MX.landHard, 'a one-off played from its trim starts that far in, and what is returned is what is left to play');
  rig.update(0.1);
  ok(Math.abs(action.time - 0.633) < 1e-6, 'and plays on from there');
  rig.update(hard);
  ok(rig.overrideName === null, 'ending after what was left, when the state\'s clip comes back');
  ok(rig.play(MX.landHard) === hard && action.time === 0 && rig.play(MX.landHard, { from: 0 }) === hard, 'with no trim it is the whole clip from its start, as every one-off was before');
  const late = rig.play(MX.landHard, { from: 99 });
  ok(late !== null && Math.abs(late - 0.02) < 1e-9 && Math.abs(action.time - (hard - 0.02)) < 1e-9, 'a trim past the clip\'s end shows its last pose for a moment and ends');
  ok(rig.play('mx_no_such_clip', { from: 0.2 }) === null, 'and a clip the rig has not got is no one-off at all');
  rig.stopOverride(0);
  // At another speed: the start is a place in the clip, and what is left of it plays at that speed.
  const fast = rig.play(MX.landHard, { from: 0.4, timeScale: 2 });
  ok(fast !== null && Math.abs(action.time - 0.4) < 1e-9 && Math.abs(fast - (hard - 0.4) / 2) < 1e-9, 'played at twice the speed from a trim it starts at the trim itself, and what is left takes half as long');
  rig.update(0.1);
  ok(Math.abs(action.time - 0.6) < 1e-6, 'and plays on at that speed');
  rig.stopOverride(0);
  // Chained onto a one-off already on the upper body alone (a swing's follow-through): the upper half starts there too.
  rig.setState('run' as never, 3);
  rig.update(1 / 60);
  rig.play('BOTH_STAND2');
  rig.overrideUpperOnly();
  const halves = (rig as unknown as { halves: Map<string, THREE.AnimationAction> }).halves;
  const chained = rig.play(MX.land, { upperOnly: true, from: 0.233 });
  const upperHalf = halves.get(`upper:${MX.land}`)!;
  ok(rig.overridingUpperOnly && chained !== null && Math.abs(chained - (rig.clipDuration(MX.land)! - 0.233)) < 1e-9 && Math.abs(upperHalf.time - 0.233) < 1e-9 && rig.overrideName === `upper:${MX.land}`, 'a one-off chained onto the upper body alone from a trim starts its upper half that far in, and answers what is left');
  ok(rig.play(MX.land, { upperOnly: true }) !== null && upperHalf.time === 0, 'and with no trim from its start');
  rig.stopOverride(0);
  rig.setState('idle' as never);
  rig.update(1);

  // The clip really is the pack's fit: the hips' rotation as the mixer shows it is the fitted track's.
  rig.prefer('float', MX.tread);
  rig.setState('idle' as never);
  rig.update(1);
  rig.setState('float' as never);
  for (let i = 0; i < 30; i++) rig.update(1 / 30);
  const tread = (rig as unknown as { actions: Map<string, THREE.AnimationAction> }).actions.get(MX.tread)!;
  const track = tread.getClip().tracks.find((t) => t.name === 'root.quaternion')!;
  const frame = Math.min(track.times.length - 2, Math.floor((tread.time / tread.getClip().duration) * (track.times.length - 1)));
  const hips = rig.bone('root')!.quaternion;
  const a = qangle([hips.x, hips.y, hips.z, hips.w], Array.from(track.values.slice(frame * 4, frame * 4 + 4)));
  const b = qangle([hips.x, hips.y, hips.z, hips.w], Array.from(track.values.slice(frame * 4 + 4, frame * 4 + 8)));
  const step = qangle(Array.from(track.values.slice(frame * 4, frame * 4 + 4)), Array.from(track.values.slice(frame * 4 + 4, frame * 4 + 8)));
  ok(a <= step + 0.01 && b <= step + 0.01, 'played by the rig, the hips show the fitted clip\'s own rotation at that moment (between its two nearest frames)');

  // What the console reads of the pose: against the bind pose, in the rig's own frame.
  const posed = rig.poseAgainstRest()!;
  const fresh = CharacterRig.fromCharacter({ group: bonesOf(), clips: [clip('idle')] } as never).poseAgainstRest()!;
  ok(fresh.hipsFromRestDeg === 0 && fresh.leftAnkleM === 0 && fresh.rightAnkleM === 0, 'a body at its bind pose reads its hips unturned and both ankles where they rest');
  ok(Math.abs(posed.hipsFromRestDeg - qangle([hips.x, hips.y, hips.z, hips.w], targetSkeleton().joints[0].restQ)) < 0.01 && posed.hipsFromRestDeg > 5 && Math.abs(posed.leftAnkleM) + Math.abs(posed.rightAnkleM) > 0.01, `and one treading reads how far its hips are turned from rest (${posed.hipsFromRestDeg} degrees) and its ankles off their rest (${posed.leftAnkleM}, ${posed.rightAnkleM} m)`);
  ok(CharacterRig.fromCharacter({ group: new THREE.Group().add(new THREE.Bone()), clips: [clip('idle')] } as never).poseAgainstRest() === null, 'a skeleton without the game\'s hips and ankles reads nothing');
  rig.root.scale.setScalar(2);
  const doubled = rig.poseAgainstRest()!;
  rig.root.scale.setScalar(1);
  ok(doubled.hipsFromRestDeg === posed.hipsFromRestDeg && Math.abs(doubled.leftAnkleM - 2 * posed.leftAnkleM) < 0.002 && Math.abs(doubled.rightAnkleM - 2 * posed.rightAnkleM) < 0.002, 'the ankles are read in the world\'s metres: the same pose on a figure drawn twice the size stands them twice as far from where they rest');

  // The rest skeleton is the rest, whatever plays.
  const made = targetSkeleton();
  const rest = rig.restSkeleton();
  let worst = 0;
  rest.joints.forEach((j, i) => {
    const m = made.joints[i];
    assert.ok(j.name === m.name && j.parent === m.parent, `${j.name} is listed where it was made`);
    worst = Math.max(worst, qangle(j.restQ, m.restQ), Math.hypot(j.restP[0] - m.restP[0], j.restP[1] - m.restP[1], j.restP[2] - m.restP[2]) * 1000);
  });
  ok(rest.joints.length === made.joints.length && worst < 1e-6 && skeletonKey(rest) === skeletonKey(made) && qangle([hips.x, hips.y, hips.z, hips.w], made.joints[0].restQ) > 5, 'the skeleton the fitter is handed is the bind pose, parent first, while a clip holds the hips 35 degrees off it');
  const lifted = bonesOf();
  const holder = new THREE.Group();
  holder.position.set(0, 0.25, 0);
  holder.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const outer = new THREE.Group();
  holder.add(...lifted.children);
  outer.add(holder);
  const base = CharacterRig.fromCharacter({ group: outer, clips: [clip('idle')] } as never).restSkeleton().base;
  ok(Math.abs(base.p[1] - 0.25) < 1e-9 && qangle(base.q, [0, Math.SQRT1_2, 0, Math.SQRT1_2]) < 1e-6, 'and whatever stands between the rig\'s root and its first joint is handed over as the skeleton\'s base');

  // More clips later, with something playing.
  const before = rig.currentClip, at = tread.time;
  const more = [clip('mx_test_only')];
  ok(rig.addClips(more) === 1 && rig.has('mx_test_only') && rig.addClips(more) === 0 && rig.addClips([clip('idle')]) === 0, 'clips added later are new actions, once, and a name the rig has is left as it was');
  ok(rig.currentClip === before && tread.time === at, 'and what is playing is not touched');

  // A second rig of the same skeleton: the same clip objects, nothing fetched.
  const fetched = asked;
  const second = CharacterRig.fromCharacter({ group: bonesOf(), clips: PACKS.species.map((n) => clip(n)) } as never);
  await attachImportedClips(second, 'a second rig');
  const clipOf = (r: Rig, n: string) => (r as unknown as { actions: Map<string, THREE.AnimationAction> }).actions.get(n)!.getClip();
  ok(used.every((n) => clipOf(second, n) === clipOf(rig, n)) && asked === fetched, 'a second rig of the skeleton plays the very same clip objects: fitted once, fetched once');

  // A landing the keys cut short gives way to the state as it stands by then (src/anim/bodyAnim.ts over the real rig).
  {
    const actionOf = (n: string) => (second as unknown as { actions: Map<string, THREE.AnimationAction> }).actions.get(n)!;
    const body = new BodyAnim(ANIM_TUNE, UNIT);
    const frame = (state: string, moving: boolean, speed = 0) => {
      body.cut(second, 1 / 60, moving);
      second.setState(state as never, speed);
      second.update(1 / 60);
    };
    second.stopOverride(0);
    second.prefer('air', null);
    for (let i = 0; i < 30; i++) frame('idle', false);
    body.stepped(false);
    // A drop that comes down at 10 m/s and does no harm: the longer landing, from the brief's trim.
    const delta = (10 / UNIT) ** 2 / 10000;
    ok(body.land(second, delta, 0, false, false, false) === 'imported' && second.overrideName === MX.land && Math.abs(actionOf(MX.land).time - ANIM_TUNE.trim.falling_to_landing) < 1e-9, 'a landing the movement reports plays the imported landing on the rig, from its trim');
    // Landed standing still; a tenth of a second on the player starts to run.
    for (let i = 0; i < 6; i++) frame('idle', false);
    ok(second.overrideName === MX.land && second.currentClip === 'idle', 'standing still, the landing plays on over the idle');
    let cutAt = -1;
    for (let i = 0; i < 40 && cutAt < 0; i++) {
      frame('run', true, 3);
      if (second.overrideName === null) cutAt = (i + 7) / 60;
    }
    ok(cutAt > 0 && Math.abs(cutAt - ANIM_TUNE.land.moveCut) < 0.035 && body.landing === null, `with a move key held it is cut once it has shown its start (after ${cutAt.toFixed(2)} s)`);
    ok(second.currentClip === 'loop_run', 'and the body is then in the run it was asked for meanwhile: the cut resolves the state as it stands, where a plain stop went back to the idle the landing began over and left the body sliding in it');
    for (let i = 0; i < 30; i++) frame('run', true, 3);
    const w = second.describe().weights;
    ok(second.currentClip === 'loop_run' && w.loop_run === 1 && second.overrideName === null, 'and stays there, at full weight');
    // The control: the plain stop, after the same landing and the same change of mind.
    second.setState('idle' as never);
    second.update(1);
    second.play(MX.land, { from: 0.233 });
    for (let i = 0; i < 6; i++) { second.setState('idle' as never); second.update(1 / 60); }
    for (let i = 0; i < 6; i++) { second.setState('run' as never, 3); second.update(1 / 60); }
    second.stopOverride(0.2);
    for (let i = 0; i < 30; i++) { second.setState('run' as never, 3); second.update(1 / 60); }
    ok(second.currentClip === 'idle', 'the plain stop, after the same landing: the state says run and the clip is still the idle (the control)');
    second.setState('idle' as never);
    second.update(1);
  }
}

// ---- the load's wait is bounded ---------------------------------------------------------------------------------------------
{
  const warn = console.warn;
  console.warn = () => {};
  const waitWas = IMPORTED_CLIPS.waitMs;
  const rig = CharacterRig.fromCharacter({ group: bonesOf(), clips: [clip('idle')] } as never);
  let hand: (c: THREE.AnimationClip[]) => void = () => {};
  IMPORTED_CLIPS.provider = () => new Promise((resolve) => (hand = resolve));
  IMPORTED_CLIPS.waitMs = 40;
  const t = performance.now();
  await attachImportedClips(rig, 'slow');
  const took = performance.now() - t;
  ok(took >= 30 && took < 2000 && !rig.has('mx_late'), `a provider that does not answer holds a rig's load only for the wait (${Math.round(took)} ms of 40), and the rig goes on without`);
  hand([clip('mx_late')]);
  await new Promise((r) => setTimeout(r, 5));
  ok(rig.has('mx_late'), 'and the clips are added when they do land');
  IMPORTED_CLIPS.provider = () => Promise.reject(new Error('the fit failed'));
  await attachImportedClips(rig, 'broken');
  IMPORTED_CLIPS.provider = () => {
    throw new Error('thrown outright');
  };
  await attachImportedClips(rig, 'broken');
  ok(rig.clipNames.length === 2, 'a provider that fails, either way, never fails a rig\'s load');
  IMPORTED_CLIPS.waitMs = waitWas;
  IMPORTED_CLIPS.provider = null;
  console.warn = warn;
  ok(waitWas === 4000, 'the wait the game ships is four seconds');
}
console.info = info;

console.log(`\n${checks} checks passed`);
