// The neutral clip pack (src/anim/mxaFile.ts, public/anims/mixamo/): its file format there and back, the mirror, the
// index's reader, and the pack this checkout carries, held to what the importer's rules say of it. The format's
// checks run on clips made here; the committed pack's run on its own files and print counts, never a clip's contents.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MX } from '../../../src/anim/animRules.ts';
import { ANIM_TUNE_SHIPPED } from '../../../src/anim/animTune.ts';
import { MXA_HEADER_BYTES, PACK_FORMAT, PACK_FPS, clipName, clipSlug, continuousSign, decodeMxa, encodeMxa, frameTime, mirrorClip, mirrorMap, readPackIndex, type PackIndex } from '../../../src/anim/mxaFile.ts';
import { SOURCE_TO_JOINT } from '../../../src/anim/mixamoMap.ts';
import { analyzeClip } from '../../anim/analyze.mjs';
import { DEG, at4, makeClip, qangle, qaxis, qmul, repoRoot, sourceBones, walkClip } from './animFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const bones = sourceBones();
const names = bones.map((b) => b.name);

// ---- the file: there and back ----------------------------------------------------------------------------------------
{
  // A clip that turns every bone a different way, through large angles, with travel that is no round number.
  const clip = makeClip(bones, 37, 1.2, (bone, t) => qmul(qaxis(Math.sin(bone.length), 1, Math.cos(bone.length * 2), 2.4 * Math.sin(t * 3 + bone.length)), qaxis(1, 0.2, 0, t * 2.2)), (t) => [0.37 * t, 1.234567 * Math.sin(t), -2.5 * t * t]);
  continuousSign(clip.quats, clip.frames, clip.bones);
  const bytes = encodeMxa(clip);
  ok(bytes.length === MXA_HEADER_BYTES + clip.frames * clip.bones * 8 + clip.frames * 12, `a clip of ${clip.frames} frames and ${clip.bones} bones is ${bytes.length} bytes: the header, four sixteen-bit numbers a bone a frame, three floats a frame`);
  const back = decodeMxa(bytes);
  ok(back.frames === clip.frames && back.bones === clip.bones && Math.abs(back.duration - clip.duration) < 1e-6, 'its counts and its length come back');
  let worst = 0;
  for (let i = 0; i < clip.frames * clip.bones; i++) worst = Math.max(worst, qangle(at4(clip.quats, i), at4(back.quats, i)));
  ok(worst < 0.01, `every rotation comes back within a hundredth of a degree (worst ${worst.toFixed(5)})`);
  let worstT = 0;
  for (let i = 0; i < clip.travel.length; i++) worstT = Math.max(worstT, Math.abs(clip.travel[i] - back.travel[i]));
  ok(worstT === 0, 'and the travel exactly (it is stored as the floats it is)');
  // Read from a slice of a larger buffer, as a fetch's answer may be.
  const padded = new Uint8Array(bytes.length + 7);
  padded.set(bytes, 7);
  ok(decodeMxa(padded.subarray(7)).frames === clip.frames, 'a clip is read from wherever its bytes begin');
  assert.throws(() => decodeMxa(bytes.subarray(0, bytes.length - 4)), /bytes/, 'a file cut short is refused');
  checks++;
  const wrong = bytes.slice();
  wrong[0] = 0x58;
  assert.throws(() => decodeMxa(wrong), /not a clip file/, 'a file that is not one is refused');
  checks++;
  assert.throws(() => encodeMxa({ ...clip, quats: clip.quats.subarray(4) }), /do not match/, 'a clip whose arrays do not match its counts is not written');
  checks++;
  ok(frameTime(0, 31, 1) === 0 && frameTime(30, 31, 1) === 1 && Math.abs(frameTime(15, 31, 1) - 0.5) < 1e-12 && frameTime(0, 1, 2) === 0, 'a clip\'s frames stand evenly from its start to its end');
  // The one rule: the importer samples a take by it and the fitter times its tracks by it (neither writes it out again).
  const fbxSrc = readFileSync(join(repoRoot(import.meta.url), 'tools', 'anim', 'fbx.mjs'), 'utf8');
  const fitSrc = readFileSync(join(repoRoot(import.meta.url), 'src', 'anim', 'fit.ts'), 'utf8');
  ok(fbxSrc.includes('mixer.setTime(Math.min(duration - 1e-5, frameTime(f, frames, duration)));') && fitSrc.includes('const t = frameTime(f, frames, T);') && !/\(f \* (duration|T)\) \/ \(frames - 1\)/.test(fbxSrc + fitSrc), 'which is the one rule the importer samples a take by and the fitter times a clip\'s tracks by');
  ok(clipSlug('Hard Landing') === 'hard_landing' && clipSlug('Walking (1)') === 'walking_1' && clipSlug('--Left  Strafe--') === 'left_strafe' && clipSlug('') === '', 'a name is made an id by one rule: lower case, every run of anything else one underscore');
}

// ---- one sign down each bone's frames --------------------------------------------------------------------------------
{
  const q = new Float32Array([0, 0, 0, 1, 0, 0, 0, -1, 0, 0.1, 0, 0.995, 0, -0.2, 0, -0.98]);
  continuousSign(q, 4, 1);
  ok(q[7] === 1 && q[11] > 0 && q[15] > 0 && q[13] > 0, 'a rotation written with the other sign is turned to its neighbour\'s, frame after frame');
}

// ---- the mirror ----------------------------------------------------------------------------------------------------
{
  const map = mirrorMap(names);
  ok(names[map[names.indexOf('LeftArm')]] === 'RightArm' && names[map[names.indexOf('RightFoot')]] === 'LeftFoot' && map[names.indexOf('Hips')] === names.indexOf('Hips') && map[names.indexOf('Spine1')] === names.indexOf('Spine1'), 'each side\'s bone mirrors onto the other side\'s, the middle\'s onto themselves');
  assert.throws(() => mirrorMap(['Hips', 'LeftArm']), /no RightArm/, 'a side with no twin cannot be mirrored');
  checks++;
  const clip = makeClip(bones, 21, 0.9, (bone, t) => qaxis(0.3 + (bone.startsWith('Left') ? 1 : 0.2), bone.length % 3, 1, 0.8 * Math.sin(t * 5 + bone.length)), (t) => [0.4 * t, 0.1 * Math.sin(t * 7), 1.1 * t]);
  const once = mirrorClip(clip, names);
  const twice = mirrorClip(once, names);
  let same = true;
  for (let i = 0; i < clip.quats.length; i++) if (clip.quats[i] !== twice.quats[i]) same = false;
  for (let i = 0; i < clip.travel.length; i++) if (clip.travel[i] !== twice.travel[i]) same = false;
  ok(same, 'a clip mirrored twice is the clip it was, every number of it');
  let moved = 0;
  for (let i = 0; i < clip.quats.length; i++) if (clip.quats[i] !== once.quats[i]) moved++;
  ok(moved > clip.quats.length / 4, 'and mirrored once it is another clip');
  // What a mirror means: the left arm's turn about the fore-and-aft axis becomes the right arm's, the other way round.
  const la = names.indexOf('LeftArm'), ra = names.indexOf('RightArm');
  const f = 7;
  const a = at4(clip.quats, f * clip.bones + la), b = at4(once.quats, f * clip.bones + ra);
  ok(Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] + b[1]) < 1e-7 && Math.abs(a[2] + b[2]) < 1e-7 && Math.abs(a[3] - b[3]) < 1e-7, 'the left arm\'s turn is the right arm\'s reflected: (x, y, z, w) to (x, -y, -z, w)');
  ok(once.travel[f * 3] === -clip.travel[f * 3] && once.travel[f * 3 + 1] === clip.travel[f * 3 + 1] && once.travel[f * 3 + 2] === clip.travel[f * 3 + 2], 'and the travel\'s sideways part is turned over, its height and its way forward kept');

  // A strafe to the left, mirrored, is a strafe to the right: measured, not asserted by the row's own arithmetic.
  const strafe = walkClip(bones, { axis: 'z' });
  const left = analyzeClip(strafe, bones);
  const right = analyzeClip(mirrorClip(strafe, names), bones);
  ok(Math.abs(left.heading - 90) < 3 && Math.abs(right.heading + 90) < 3, `a strafe that goes left (${left.heading.toFixed(1)} degrees), mirrored, goes right (${right.heading.toFixed(1)})`);
  ok(Math.abs(left.speed - right.speed) < 1e-6 && left.feet.length === right.feet.length && left.feet.every((m, i) => right.feet.some((r) => r.foot !== m.foot && Math.abs(r.t - m.t) < 1e-9) && i >= 0), 'at the same speed, each foot coming down when the other did');
  // And one that travels to the left as it goes: its twin's hips travel to the right, measured the same way.
  const carried = analyzeClip(walkClip(bones, { axis: 'z', speed: left.speed }), bones);
  const carriedTwin = analyzeClip(mirrorClip(walkClip(bones, { axis: 'z', speed: left.speed }), names), bones);
  ok(carried.travelNet[0] > 0.5 && Math.abs(carriedTwin.travelNet[0] + carried.travelNet[0]) < 1e-6 && Math.abs(carriedTwin.heading + carried.heading) < 1e-6, 'a strafe carried to the left by its hips is carried to the right in its twin: the travel is turned over with the heading');
}

// ---- the index's reader ----------------------------------------------------------------------------------------------
{
  const good = (): PackIndex => ({
    format: PACK_FORMAT,
    fps: PACK_FPS,
    bones: bones.map((b) => ({ ...b, rest: [...b.rest] as [number, number, number] })),
    clips: [
      { id: 'test_walk', file: 'test_walk.mxa', frames: 31, duration: 1, loop: true, travelNet: [0, 0, 0], speed: 1.5, heading: 0, feet: [{ t: 0.1, foot: 'L' }], trimStart: 0, use: true, source: 'Test Walk.fbx', hash: 'abc' },
      { id: 'test_walk_mirrored', file: 'test_walk_mirrored.mxa', frames: 31, duration: 1, loop: true, travelNet: [0, 0, 0], speed: 1.5, heading: 0, feet: [], trimStart: 0, mirrorOf: 'test_walk', use: false, source: 'Test Walk.fbx', hash: 'abd' },
    ],
  });
  const read = readPackIndex(JSON.parse(JSON.stringify(good())));
  ok(typeof read !== 'string' && read.clips.length === 2 && read.bones.length === bones.length && read.clips[1].mirrorOf === 'test_walk', 'an index the importer could have written is read whole');
  const refused = (change: (i: Record<string, any>) => void, why: RegExp, what: string) => {
    const i = JSON.parse(JSON.stringify(good())) as Record<string, any>;
    change(i);
    const r = readPackIndex(i);
    ok(typeof r === 'string' && why.test(r), `${what} (${typeof r === 'string' ? r : 'read'})`);
  };
  refused((i) => (i.format = 2), /format 2/, 'an index of another format is refused');
  refused((i) => (i.clips[0].file = 'other.mxa'), /its file/, 'a clip whose file is not its id\'s is refused');
  refused((i) => (i.clips[0].id = '../x'), /plain word/, 'an id that is not a plain word is refused');
  refused((i) => (i.clips[1].id = 'test_walk'), /plain word/, 'two clips of one id are refused');
  refused((i) => (i.clips[0].trimStart = 2), /trim/, 'a trim past the clip\'s end is refused');
  refused((i) => (i.clips[0].feet = [{ t: 0.1, foot: 'M' }]), /foot marks/, 'a foot mark of no foot is refused');
  refused((i) => (i.clips[1].mirrorOf = 'nobody'), /has not got/, 'a twin of a clip the index has not got is refused');
  refused((i) => (i.bones[3].parent = 9), /bone 3/, 'a bone listed before its parent is refused');
  refused((i) => (i.bones[2].name = 'Hips'), /share a name/, 'two bones of one name are refused');
  ok(typeof readPackIndex(null) === 'string' && typeof readPackIndex('page') === 'string' && typeof readPackIndex({}) === 'string', 'and so is anything that is no index at all');
  ok(clipName('falling_idle') === 'mx_falling_idle', 'a clip\'s name in the game is its id behind mx_');
}

// ---- the pack this checkout carries ----------------------------------------------------------------------------------
{
  const root = repoRoot(import.meta.url);
  const dir = join(root, 'public', 'anims', 'mixamo');
  ok(existsSync(join(dir, 'index.json')), 'the checkout carries the imported pack (public/anims/mixamo/index.json): the game ships it, so a checkout without it is a checkout to import into');
  const index = readPackIndex(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')));
  if (typeof index === 'string') throw new Error(`the committed index cannot be read: ${index}`);
  ok(index.fps === PACK_FPS && index.bones.length >= 50 && index.bones[0].name === 'Hips', `it reads whole: ${index.clips.length} clips over ${index.bones.length} bones at ${index.fps} frames a second`);
  const packNames = index.bones.map((b) => b.name);
  ok(Object.keys(SOURCE_TO_JOINT).every((b) => packNames.includes(b)), 'every bone the map drives a joint from is in its skeleton');
  ok(packNames.every((n) => !/^mixamorig/i.test(n)) && mirrorMap(packNames).length === packNames.length, 'its bones carry no prefix of the source\'s, and every side\'s bone has its twin');
  const hips = index.bones[0].rest, lf = index.bones[packNames.indexOf('LeftFoot')].rest, rf = index.bones[packNames.indexOf('RightFoot')].rest, toe = index.bones[packNames.indexOf('LeftToeBase')].rest;
  ok(hips[1] > 0.9 && hips[1] < 1.2 && lf[0] > 0 && rf[0] < 0 && Math.abs(lf[0] + rf[0]) < 1e-3 && toe[2] > lf[2] && lf[1] < 0.15, `its rest is metres, Y up, left +X, facing +Z (hips ${hips[1].toFixed(3)} m up, the left ankle at x ${lf[0].toFixed(3)}, the toe ahead of it)`);

  // Every clip file: there, of the index's counts, of the index's hash, and nothing else in the folder.
  const onDisk = readdirSync(dir).sort();
  const want = ['index.json', ...index.clips.map((c) => c.file)].sort();
  ok(JSON.stringify(onDisk) === JSON.stringify(want), `the folder holds the index and its ${index.clips.length} clip files and nothing else (no source file, no stale clip)`);
  let bytes = 0, worstUnit = 0;
  const data = new Map<string, ReturnType<typeof decodeMxa>>();
  for (const row of index.clips) {
    const b = readFileSync(join(dir, row.file));
    bytes += b.length;
    const clip = decodeMxa(b);
    data.set(row.id, clip);
    assert.ok(clip.frames === row.frames && clip.bones === index.bones.length, `${row.id}: its file is of the index's frames and bones`);
    assert.ok(Math.abs(clip.duration - row.duration) < 1e-4, `${row.id}: its file is of the index's length`);
    assert.ok(createHash('sha1').update(b).digest('hex').slice(0, 12) === row.hash, `${row.id}: its hash is its file's`);
    assert.ok(Math.abs(row.frames - 1 - row.duration * PACK_FPS) < 0.51, `${row.id}: it has as many frames as thirty a second gives its length, to the nearest`);
    for (let i = 0; i < clip.quats.length; i += 4) worstUnit = Math.max(worstUnit, Math.abs(Math.hypot(clip.quats[i], clip.quats[i + 1], clip.quats[i + 2], clip.quats[i + 3]) - 1));
  }
  checks += 4;
  ok(worstUnit < 1e-5, `every clip file decodes, of the index's frames, bones, length and hash (${(bytes / 1048576).toFixed(2)} MB in all), every rotation a unit one`);

  // The clips the game plays at start are exactly the ones its rules name.
  const used = index.clips.filter((c) => c.use).map((c) => clipName(c.id)).sort();
  ok(JSON.stringify(used) === JSON.stringify(Object.values(MX).sort()), `the clips marked for the game are the ten its rules name (${used.length})`);
  for (const [id, trim] of Object.entries(ANIM_TUNE_SHIPPED.trim)) {
    const row = index.clips.find((c) => c.id === id);
    assert.ok(row && Math.abs(row.trimStart - trim) < 1e-9, `${id}: the pack's trim (${row?.trimStart}) is the tune's start (${trim})`);
  }
  checks++;
  ok(true, 'and each trimmed clip\'s trim in the pack is the tune\'s own start, so the two are one number');

  // A take read to its true end: the one-offs end somewhere else than they began. (A reader that asked a repeating
  // take for exactly its end was answered with its beginning, and every clip read as a loop.)
  const far = (id: string) => {
    const clip = data.get(id)!;
    let worst = 0;
    for (let b = 0; b < clip.bones; b++) worst = Math.max(worst, qangle(at4(clip.quats, b), at4(clip.quats, (clip.frames - 1) * clip.bones + b)));
    return worst;
  };
  const row = (id: string) => index.clips.find((c) => c.id === id)!;
  ok(far('hard_landing') > 20 && far('falling_flat_impact') > 20 && !row('hard_landing').loop && !row('falling_to_landing').loop && !row('jumping_up').loop && row('hard_landing').travelNet[1] < -1, `the landings are no loops and end far from where they began (the hard one a bone ${far('hard_landing').toFixed(0)} degrees round and its hips ${(-row('hard_landing').travelNet[1]).toFixed(2)} m lower)`);
  ok(['treading_water', 'flying', 'falling', 'falling_idle', 'floating'].every((id) => row(id).loop && far(id) < 6 && row(id).feet.length === 0 && row(id).speed === 0), 'the five loops of the air and the water loop, and have no foot marks and no speed: nothing is under their feet');
  ok(row('floating').level !== undefined && row('floating').level! > 0.2 && row('falling_idle').level === undefined, `the float is levelled (it rides ${row('floating').level?.toFixed(2)} m over its rest height as authored) and the falling loop is not`);

  // The three clips that travel: what their feet say against what their hips did.
  const travelling: [string, number][] = [];
  for (const c of index.clips) {
    const level = Math.hypot(c.travelNet[0], c.travelNet[2]);
    if (c.loop && level > 0.3 && c.speed > 0 && !c.mirrorOf) travelling.push([c.id, c.speed / (level / c.duration) - 1]);
  }
  for (const id of ['left_strafe_walking', 'walk_strafe_right', 'sneak_walk']) ok(travelling.some(([t]) => t === id), `${id} travels, loops and has its feet measured`);
  ok(travelling.every(([, off]) => Math.abs(off) < 0.15), `every travelling loop's foot speed is within 15% of its travel over its length (${travelling.map(([id, off]) => `${id} ${off >= 0 ? '+' : ''}${(off * 100).toFixed(0)}%`).join(', ')})`);

  // Headings and marks by what the clips are.
  const near = (v: number, target: number, tol: number) => Math.abs(((v - target + 540) % 360) - 180) < tol;
  ok(near(row('walking').heading, 0, 5) && near(row('walking_backwards').heading, 180, 5) && near(row('left_strafe').heading, 90, 5) && near(row('right_strafe_walking').heading, -90, 5), 'a walk heads forward, a back-pedal back, a left strafe left and a right one right');
  // The three that travel: their hips went the way their feet say the body goes (left is +X, forward +Z).
  const went = (id: string) => (Math.atan2(row(id).travelNet[0], row(id).travelNet[2]) * 180) / Math.PI;
  ok(['left_strafe_walking', 'walk_strafe_right', 'sneak_walk'].every((id) => near(went(id), row(id).heading, 15)) && row('left_strafe_walking').travelNet[0] > 1 && row('walk_strafe_right').travelNet[0] < -0.5 && row('sneak_walk').travelNet[2] > 1, `and each travelling clip's hips went the way its feet head: the left strafe to +X (${went('left_strafe_walking').toFixed(0)} degrees), the right one to -X (${went('walk_strafe_right').toFixed(0)}), the sneak forward (${went('sneak_walk').toFixed(0)})`);
  // What the table says over the measurement, in the pack as committed.
  ok(row('falling_flat_impact').feet.length === 0 && row('falling_flat_impact').speed === 0 && !row('falling_flat_impact').loop, 'the thrown fall\'s impact carries no foot marks: it is a body landing flat, and a leg settling beside it is no footstep');
  ok(['ascending_stairs', 'ascending_stairs_1', 'running_up_stairs'].every((id) => row(id).loop && far(id) < 6) && ['descending_stairs', 'descending_stairs_1'].every((id) => !row(id).loop && far(id) > 40), `the stairs that climb end pose for pose as they began and are cycles; the two that descend end ${far('descending_stairs').toFixed(0)} and ${far('descending_stairs_1').toFixed(0)} degrees from where they began and are not`);
  for (const id of ['jog_strafe_left', 'left_strafe', 'jog_forward_diagonal', 'jog_backward_diagonal']) {
    const a = row(id), b = row(`${id}_mirrored`);
    assert.ok(b && b.mirrorOf === id && near(b.heading, -a.heading, 1) && Math.abs(a.speed - b.speed) < 0.02 && !b.use, `${id}_mirrored is ${id}'s twin, heading the other way at its speed`);
    const twin = mirrorClip(data.get(id)!, packNames);
    const stored = data.get(`${id}_mirrored`)!;
    let worst = 0;
    for (let i = 0; i < twin.quats.length; i += 4) worst = Math.max(worst, qangle([twin.quats[i], twin.quats[i + 1], twin.quats[i + 2], twin.quats[i + 3]], [stored.quats[i], stored.quats[i + 1], stored.quats[i + 2], stored.quats[i + 3]]));
    assert.ok(worst < 0.02, `${id}_mirrored's file is ${id}'s mirror image (worst ${worst.toFixed(4)} degrees)`);
  }
  checks++;
  ok(true, 'the four clips the brief wants mirrored each have a twin whose file is their mirror image and whose heading is the opposite');
  const walks = ['walking', 'standard_walk', 'dwarf_walk', 'orc_walk', 'walking_2', 'running', 'fast_run', 'slow_run', 'jog_backward', 'crouched_walking'];
  ok(walks.every((id) => row(id).feet.length === 2 && new Set(row(id).feet.map((m) => m.foot)).size === 2 && row(id).feet.every((m) => m.t >= 0 && m.t < row(id).duration)), 'a walk or a run cycle has two foot marks, one a foot, inside the clip');
  ok(row('running').speed > row('slow_run').speed && row('slow_run').speed > row('walking').speed && row('walking').speed > 1 && row('fast_run').speed > 4, `and the faster gaits measure faster (walk ${row('walking').speed}, slow run ${row('slow_run').speed}, run ${row('running').speed}, fast run ${row('fast_run').speed} m/s)`);
  // The landings' marks: where the feet come down, after the trim.
  ok(row('hard_landing').feet[0].t > row('hard_landing').trimStart && row('falling_to_landing').feet[0].t > row('falling_to_landing').trimStart, 'each trimmed landing\'s feet come down after its trim, so the step is heard');
  ok(index.clips.every((c) => /\.fbx$/i.test(c.source) && !/[\\:]/.test(c.source)), 'every clip names the file it came from, relative to the imported folder');
  note(`${index.clips.length} clips, ${index.clips.filter((c) => c.loop).length} loops, ${index.clips.filter((c) => c.feet.length).length} with foot marks, ${index.clips.filter((c) => c.mirrorOf).length} mirrored twins`);
  void DEG;
}

console.log(`\n${checks} checks passed`);
