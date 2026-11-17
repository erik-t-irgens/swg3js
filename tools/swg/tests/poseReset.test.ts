// A respawn takes the skeleton back from a ragdoll (src/anim/poseReset.ts, `Rig.retakePose`, called by
// `Player.endRagdoll`). The owner, 2026-11-17: "when dying, respawning is off since the animation changes. Sometimes my
// eyes and mouth will be coming out the back of my head, or my arms will be messed up."
//
// Two figures of the game's own skeleton (the human male's where the packs are on this machine, else the fixtures'
// stand-in) play the same fitted Mixamo clip on three's own mixer. One is posed as a ragdoll leaves a body (every bone
// turned and moved), and has a clip that drives every joint first played while it stands so (as the game's own clips,
// Jedi Academy's among them, do after a death) and then stopped; then it is handed back. After the next frame it must
// stand exactly as the one nothing happened to, bone for bone; and without the hand-back it must not, which is what
// shows the check can see the fault.
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MixamoPack } from '../../../src/anim/mixamoPack.ts';
import { forgetMixerWrites, poseAtRest } from '../../../src/anim/poseReset.ts';
import { glbSkeleton, repoRoot, speciesBodies, targetSkeleton } from './animFixtures.ts';

let checks = 0;
function ok(cond: unknown, what: string): void {
  if (!cond) throw new Error(`poseReset: ${what}`);
  checks++;
  console.log(`ok   ${what}`);
}

const root = repoRoot(import.meta.url);
const body = speciesBodies(root).find((b) => b.id === 'human_male');
const target = body ? glbSkeleton(body.body) : targetSkeleton();
console.info = () => {};
const packDir = join(root, 'public', 'anims', 'mixamo');
const pack = new MixamoPack({
  enabled: () => true,
  index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
  clip: async (file: string) => {
    const b = readFileSync(join(packDir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
  breath: async () => {},
  also: [],
  now: () => performance.now(),
});
const clips = await pack.clipsFor(target as never, 'poseReset');
// A clip that moves: the first of the pack's walks, else whatever the pack handed over first.
const clip = clips.find((c) => /walk/.test(c.name)) ?? clips[0];
ok(!!clip && clip.tracks.length > 0, `the pack fits a clip to the skeleton (${clip?.name}, ${clip?.tracks.length} tracks over ${target.joints.length} joints)`);

interface Figure {
  scene: THREE.Group;
  bones: THREE.Bone[];
  restQ: Map<THREE.Bone, THREE.Quaternion>;
  restP: Map<THREE.Bone, THREE.Vector3>;
  restS: Map<THREE.Bone, THREE.Vector3>;
  mixer: THREE.AnimationMixer;
}
function figure(): Figure {
  const scene = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.fromArray(target.base.p);
  inner.quaternion.fromArray(target.base.q);
  scene.add(inner);
  const bones: THREE.Bone[] = [];
  const restQ = new Map<THREE.Bone, THREE.Quaternion>();
  const restP = new Map<THREE.Bone, THREE.Vector3>();
  const restS = new Map<THREE.Bone, THREE.Vector3>();
  target.joints.forEach((j) => {
    const b = new THREE.Bone();
    b.name = j.name;
    b.position.fromArray(j.restP);
    b.quaternion.fromArray(j.restQ);
    bones.push(b);
    (j.parent < 0 ? inner : bones[j.parent]).add(b);
    // As the rig records them when it is made.
    restQ.set(b, b.quaternion.clone());
    restP.set(b, b.position.clone());
    restS.set(b, b.scale.clone());
  });
  return { scene, bones, restQ, restP, restS, mixer: new THREE.AnimationMixer(scene) };
}

/** A clip that drives every joint (as the game's own clips do), each held at a turn and place of its own. */
function wholeClip(f: Figure): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  f.bones.forEach((b, i) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3 + i * 0.07, -0.2 + i * 0.05, 0.1 * (i % 5)));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0, 1], [...q.toArray(), ...q.toArray()]));
    tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, [0, 1], [...b.position.toArray(), ...b.position.toArray()]));
  });
  return new THREE.AnimationClip('whole', 1, tracks);
}

/** Every bone turned and moved, as a ragdoll's last frame leaves a body. */
function scramble(f: Figure, seed: number): void {
  f.bones.forEach((b, i) => {
    b.quaternion.setFromEuler(new THREE.Euler(seed + i * 0.91, seed * 2 - i * 0.37, 1.7 + i * 0.29)).normalize();
    b.position.x += 0.05 * Math.sin(seed + i);
  });
}

const DT = 1 / 60;
function differs(a: Figure, b: Figure): { bones: number; worstAngle: number; worstPlace: number; names: string[]; angles: number[]; places: number[] } {
  let n = 0;
  let worstAngle = 0;
  let worstPlace = 0;
  const names: string[] = [];
  const angles: number[] = [];
  const places: number[] = [];
  for (let i = 0; i < a.bones.length; i++) {
    const angle = a.bones[i].quaternion.angleTo(b.bones[i].quaternion);
    const place = a.bones[i].position.distanceTo(b.bones[i].position);
    angles.push(angle);
    places.push(place);
    worstAngle = Math.max(worstAngle, angle);
    worstPlace = Math.max(worstPlace, place);
    if (angle > 1e-6 || place > 1e-7) n++;
    // Named only where it is plainly off (a hundredth of a radian, a millimetre), so a message names what the ragdoll left.
    if ((angle > 0.01 || place > 1e-3) && names.length < 6) names.push(`${a.bones[i].name} ${angle.toFixed(2)} rad ${(place * 100).toFixed(1)} cm`);
  }
  return { bones: n, worstAngle, worstPlace, names, angles, places };
}

/**
 * A death and a respawn: the walk played to `before` seconds, the body scrambled, the whole clip first played (its
 * bindings made now, so their "original" is the scrambled pose) and stopped, the hand-back if `retake`, and the walk on
 * for `after` seconds. The other figure only walks for the same time.
 */
async function respawn(o: { scrambled: boolean; whole: boolean; retake: boolean }, before: number, after: number, seed: number): Promise<{ d: ReturnType<typeof differs>; bindings: number }> {
  const a = figure();
  const b = figure();
  const wa = a.mixer.clipAction(clip);
  const wb = b.mixer.clipAction(clip);
  wa.play();
  wb.play();
  a.mixer.update(before);
  b.mixer.update(before);
  if (o.scrambled) scramble(a, seed);
  if (o.whole) {
    const whole = a.mixer.clipAction(wholeClip(a));
    whole.play();
    a.mixer.update(0);
    whole.stop();
  }
  let bindings = 0;
  if (o.retake) {
    poseAtRest(a.bones, a.restQ, a.restP, a.restS);
    bindings = forgetMixerWrites(a.mixer);
  }
  for (let t = 0; t < after - 1e-9; t += DT) {
    a.mixer.update(DT);
    b.mixer.update(DT);
  }
  return { d: differs(a, b), bindings };
}

// Two figures stepped through the very same calls do not stand exactly alike: this clip's lThigh and rWrist part by a few
// tenths of a milliradian (measured while writing this: 3.5e-4 and 2.5e-4 rad, with nothing done to either, whichever is
// made or stepped first, a figure thrown away first or not), three's own and no part of what is tested. So the fixed
// figure is held to that floor itself, bone for bone: a figure handed back after a ragdoll stands exactly as one that
// never died stands in the same comparison.
for (const [before, after, seed] of [[0.5, DT, 1], [1.37, 0.5, 2], [0.2, 2, 3]] as const) {
  const floor = await respawn({ scrambled: false, whole: false, retake: false }, before, after, seed);
  const fixed = await respawn({ scrambled: true, whole: true, retake: true }, before, after, seed);
  ok(fixed.bindings > clip.tracks.length, `the hand-back reaches every binding the mixer holds (${fixed.bindings}, the walk's ${clip.tracks.length} and the whole clip's)`);
  let worst = 0;
  for (let i = 0; i < fixed.d.angles.length; i++) worst = Math.max(worst, Math.abs(fixed.d.angles[i] - floor.d.angles[i]), Math.abs(fixed.d.places[i] - floor.d.places[i]));
  ok(worst < 1e-9, `handed back after ${before} s of walking, a ragdoll and a clip first played in its pose, ${after.toFixed(3)} s on every bone stands as a figure that never died stands (each bone within ${worst.toExponential(1)} of the floor; the floor's worst ${floor.d.worstAngle.toExponential(2)} rad)`);
  const broken = await respawn({ scrambled: true, whole: true, retake: false }, before, after, seed);
  ok(broken.d.worstAngle > 0.1, `without the hand-back ${broken.d.bones} bones stay as the ragdoll or the stopped clip left them (worst ${broken.d.worstAngle.toFixed(2)} rad: ${broken.d.names.join(', ')}), which is the fault the check sees`);
  const ragdollOnly = await respawn({ scrambled: true, whole: false, retake: false }, before, after, seed);
  ok(ragdollOnly.d.worstAngle > 0.1, `and a ragdoll alone, with no clip played in its pose, leaves ${ragdollOnly.d.bones} bones off (worst ${ragdollOnly.d.worstAngle.toFixed(2)} rad: ${ragdollOnly.d.names.join(', ')})`);
}

// The game hands the skeleton back where the ragdoll ends, through the rig, for every way out of a death.
{
  const fold = (s: string) => s.replace(/\r\n/g, '\n');
  const player = fold(readFileSync(join(root, 'src', 'player', 'player.ts'), 'utf8'));
  const rig = fold(readFileSync(join(root, 'src', 'player', 'rig.ts'), 'utf8'));
  const end = player.slice(player.indexOf('  endRagdoll(): void {'), player.indexOf('\n  }\n', player.indexOf('  endRagdoll(): void {')));
  ok(/this\.ragdoll\.dispose\(\);[\s\S]*this\.rig\?\.retakePose\(\);/.test(end), '`Player.endRagdoll` hands the skeleton back to the rig after the ragdoll is gone');
  const take = rig.slice(rig.indexOf('  retakePose(): void {'), rig.indexOf('\n  }\n', rig.indexOf('  retakePose(): void {')));
  ok(take.includes('poseAtRest(this.bones.values(), this.restLocal, this.restPosition, this.restScale);') && take.includes('forgetMixerWrites(this.mixer);'), '`Rig.retakePose` puts every bone on the rest it recorded and tells the mixer so');
  ok(take.indexOf('this.limbPose?.restore();') < take.indexOf('poseAtRest(') && take.indexOf('this.legPose?.restore();') < take.indexOf('poseAtRest(') && take.indexOf('this.clearLook();') < take.indexOf('poseAtRest('), 'and lets go of the limbs\', legs\' and look\'s own placements first, so none puts an old pose back');
}

console.log(`poseReset: ${checks} checks passed`);
