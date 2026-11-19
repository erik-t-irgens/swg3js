// The importer's own rules (tools/anim/): what it measures of a clip, on a walk made here whose answers are known by
// arithmetic; how it names a file; and its table. Where the folder of source files is on this machine (named by
// SWG3JS_MIXAMO_FBX, never committed), the committed pack is held to a fresh import of it, file for file.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MX } from '../../../src/anim/animRules.ts';
import { tableClips } from '../../../src/anim/locoTable.ts';
import { ANIM_TUNE_SHIPPED } from '../../../src/anim/animTune.ts';
import { clipName, clipSlug, decodeMxa, mirrorClip, readPackIndex } from '../../../src/anim/mxaFile.ts';
import { ANALYZE, analyzeClip, posePositions, settle, settledShares } from '../../anim/analyze.mjs';
import { readFbx, restDifference } from '../../anim/fbx.mjs';
import { TRAVEL_APART, idsFor, importFolder, reportLines, slug } from '../../anim/importer.mjs';
import { CLIPS, CLIP_DEFAULTS, rowFor } from '../../anim/mixamoClips.mjs';
import { fbxBonesOf, fbxText, type FbxBone, type FbxTake } from './animFbxFixture.ts';
import { DEG, at4, makeClip, qangle, qaxis, qmul, repoRoot, sourceBones, strideWalk, walkClip, walkTopSpeed } from './animFixtures.ts';
import { loadOld } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const bones = sourceBones();
const at = (name: string) => bones.findIndex((b) => b.name === name);

// ---- where the bones are ---------------------------------------------------------------------------------------------
{
  const still = makeClip(bones, 3, 0.1, () => [0, 0, 0, 1], (t) => [t, 2 * t, -t]);
  const p0 = posePositions(still, bones, 0);
  ok(bones.every((b, i) => Math.abs(p0[i * 3] - b.rest[0]) < 1e-9 && Math.abs(p0[i * 3 + 1] - b.rest[1]) < 1e-9 && Math.abs(p0[i * 3 + 2] - b.rest[2]) < 1e-9), 'with no turn and no travel every bone stands where it rests');
  const p2 = posePositions(still, bones, 2);
  ok(bones.every((b, i) => Math.abs(p2[i * 3] - b.rest[0] - 0.1) < 1e-6 && Math.abs(p2[i * 3 + 1] - b.rest[1] - 0.2) < 1e-6 && Math.abs(p2[i * 3 + 2] - b.rest[2] + 0.1) < 1e-6), 'and the hips\' travel carries the whole figure');
  // The left leg turned a quarter forward at the hip: the ankle ends level with the hip, ahead of it by the leg's length.
  const kick = makeClip(bones, 2, 0.1, (bone) => (/^Left(UpLeg|Leg|Foot|ToeBase)$/.test(bone) ? qaxis(1, 0, 0, -Math.PI / 2) : [0, 0, 0, 1]));
  const p = posePositions(kick, bones, 1);
  const hip = bones[at('LeftUpLeg')].rest, ankle = bones[at('LeftFoot')].rest;
  const drop = hip[1] - ankle[1];
  ok(Math.abs(p[at('LeftFoot') * 3 + 2] - (hip[2] + drop)) < 1e-6 && Math.abs(p[at('LeftFoot') * 3 + 1] - (hip[1] + (ankle[2] - hip[2]))) < 1e-6 && Math.abs(p[at('RightFoot') * 3 + 1] - bones[at('RightFoot')].rest[1]) < 1e-9, 'a bone stands off its parent by their rest offset turned by the parent\'s turn (a leg swung a quarter forward puts the ankle ahead of the hip by the leg\'s drop)');
}

// ---- a walk whose answers are known ----------------------------------------------------------------------------------
{
  const top = walkTopSpeed(bones);
  const walk = walkClip(bones);
  const a = analyzeClip(walk, bones);
  ok(a.loop && a.endAngle < 1e-3 && Math.hypot(...(a.travelNet as [number, number, number])) < 1e-9, 'a walk in place ends as it began: a loop, with no travel');
  ok(a.speed > 0.7 * top && a.speed <= top * 1.001, `its planted feet say ${a.speed.toFixed(2)} m/s, between seven tenths of and all of the fastest its foot passes under the hips (${top.toFixed(2)}: a planted foot is slower at either end of its spell)`);
  ok(Math.abs(a.heading) < 2, `heading forward (${a.heading.toFixed(1)} degrees)`);
  ok(a.feet.length === 2 && a.feet[0].foot !== a.feet[1].foot && Math.abs(Math.abs(a.feet[0].t - a.feet[1].t) - 0.5) < 0.04, `each foot comes down once a cycle, half a cycle apart (${a.feet.map((m: { t: number; foot: string }) => `${m.foot} ${m.t.toFixed(2)}`).join(', ')})`);
  // Which foot, and on which frame: held to the feet's own heights, worked out here. The walk's left leg starts by
  // swinging back, so the right foot is the first to come forward and down; a foot is down on the first frame its
  // ankle comes within the planting height of the lowest it gets, having been over it the frame before.
  const dt = walk.duration / (walk.frames - 1);
  const ankle = (name: string, f: number) => posePositions(walk, bones, f)[at(name) * 3 + 1];
  const lowest = (name: string) => Math.min(...Array.from({ length: walk.frames }, (_, f) => ankle(name, f)));
  const down = (name: string, f: number) => ankle(name, f) - lowest(name) <= ANALYZE.plantNear;
  const fr = Math.round(a.feet[0].t / dt), fl = Math.round(a.feet[1].t / dt);
  ok(a.feet[0].foot === 'R' && a.feet[1].foot === 'L' && Math.abs(a.feet[0].t - fr * dt) < 1e-4 && Math.abs(a.feet[1].t - fl * dt) < 1e-4 && fl - fr === 15, `the right foot comes down first (frame ${fr}) and the left half a cycle on (frame ${fl}), each mark on a frame of the clip`);
  ok(down('RightFoot', fr) && !down('RightFoot', fr - 1) && down('LeftFoot', fl) && !down('LeftFoot', fl - 1), 'and each mark stands on the very frame its foot comes down: the ankle within the planting height there, and over it the frame before');
  // Twice the cadence: the foot passes under the hips twice as fast, and the measure follows it. (Not exactly double:
  // a foot moving up and down twice as fast is "still" for a shorter spell, nearer its fastest.)
  const quick = analyzeClip(walkClip(bones, { period: 0.5, frames: 16 }), bones);
  ok(quick.speed > 1.8 * a.speed && quick.speed > 0.7 * 2 * top && quick.speed <= 2 * top * 1.001 && quick.feet.length === 2, `the same walk at twice the cadence measures about twice as fast (${quick.speed.toFixed(2)} m/s, its foot's fastest ${(2 * top).toFixed(2)})`);
  // The same walk carried along by its hips at the speed its feet say: the feet say the same, and the two agree.
  const carried = walkClip(bones, { speed: a.speed });
  const c = analyzeClip(carried, bones);
  ok(c.loop && Math.abs(c.travelNet[2] - a.speed) < 1e-6, 'carried along by its hips it still loops: a loop may travel');
  ok(Math.abs(c.speed - a.speed) < 0.02 * a.speed && Math.abs(c.heading) < 2 && c.feet.length === 2, `and its feet say the same speed whether the hips travel or not (${c.speed.toFixed(2)} against ${a.speed.toFixed(2)})`);
  ok(Math.abs(c.speed / (Math.hypot(c.travelNet[0], c.travelNet[2]) / carried.duration) - 1) < TRAVEL_APART / 100, `which is its travel over its length, within the ${TRAVEL_APART}% the importer holds a level travelling clip to`);
  // Sideways.
  const side = analyzeClip(walkClip(bones, { axis: 'z' }), bones);
  ok(Math.abs(side.heading - 90) < 3 && side.speed > 0.7 * top && side.feet.length === 2, `a walk whose legs swing sideways heads left (${side.heading.toFixed(1)} degrees) at the same speed`);
  // A foot coming forward low over the ground is not planted: a knee that lifts it only a few centimetres leaves it as
  // low as a planted one for part of its swing, and what tells the two apart is which way it moves under the hips.
  const fooled = analyzeClip(walk, bones, { tune: { ...ANALYZE, goes: Infinity } });
  ok(fooled.planted.L > a.planted.L && fooled.feet.length > 2, `by its height alone a foot just starting forward reads as planted: ${fooled.planted.L} of the left foot's frames against ${a.planted.L}, and ${fooled.feet.length} marks where there are two steps; the second look, at which way each foot moves under the hips, is what leaves two`);
  // Nothing under the feet.
  const air = analyzeClip(walk, bones, { ground: false });
  ok(air.speed === 0 && air.feet.length === 0 && air.heading === 0 && air.loop, 'told it has no ground under it, a clip has no speed and no foot marks');
  const high = makeClip(bones, 31, 1, (bone, t) => (/^(Left|Right)(UpLeg|Leg|Foot|ToeBase)$/.test(bone) ? qaxis(1, 0, 0, 0.3 * Math.sin(t * 6.283 + (bone.startsWith('Left') ? 0 : 3.14))) : [0, 0, 0, 1]), () => [0, 0.5, 0]);
  const h = analyzeClip(high, bones);
  ok(h.speed === 0 && h.feet.length === 0, `and a clip whose feet never come within ${ANALYZE.floorNear} m of where a standing foot is has none either, told or not (a hang, a fall)`);
  ok(Math.abs(h.footHeightAt(0.5) - 0.5) < 0.06 && Math.abs(a.footHeightAt(0)) < 0.02, 'how high the lower foot stands over the floor is its height less its standing height');
}

// ---- a walk whose stride is known: the speed is read off the stances' settled middles ---------------------------------------
{
  // Each foot lies flat for 0.4 of a stride going back over the clip's ground at exactly 1 m/s; round that, the heel comes
  // down with the toe still up (going back at 0.8 m/s) and rolls up off a toe still planted; and the hips sway fore and aft
  // by 3 cm twice a stride. In place, and carried along at its own speed (its planted feet standing still on its ground).
  const old = await loadOld<{ analyzeClip: typeof analyzeClip }>(['tools/anim/analyze.mjs'], 'tools/anim/analyze.mjs', '91e62d9');
  for (const [label, travel] of [['in place', 0], ['carried along at its own speed', 1]] as const) {
    const clip = strideWalk(bones, { speed: 1, travel });
    const a = analyzeClip(clip, bones);
    const middle = a.middle.L.length + a.middle.R.length;
    ok(a.loop && a.feet.length === 2 && a.feet[0].foot !== a.feet[1].foot && a.planted.L > a.middle.L.length && a.planted.R > a.middle.R.length && middle > 30, `a walk ${label} with a known stride: two steps a stride, each foot planted for more frames than its settled middle holds (${a.planted.L} and ${a.planted.R} planted, ${a.middle.L.length} and ${a.middle.R.length} settled: the landing and the lifting are planted and not settled)`);
    ok(Math.abs(a.speed - 1) < 0.005, `and its speed, read off the settled middles against the ground the clip is carried on, is the stride's own within half a percent (${a.speed.toFixed(4)} m/s against 1)`);
    if (old) {
      const was = old.analyzeClip(clip, bones).speed;
      ok(Math.abs(was - 1) > 0.02, `where the measure before (91e62d9's: under the hips, over every planted frame, the landing and the lifting among them) reads ${was.toFixed(3)} m/s, ${((was - 1) * 100).toFixed(1)}% off`);
    } else note('git cannot hand over 91e62d9\'s measure here: it is not compared');
  }
  // Each of the three things round the middles alone: the lifting (no sway, a landing as fast as the stance), the
  // lifting and the slower landing, the lifting and the sway. The measure reads the stride in every one; the one before
  // reads each of them wrong on its own.
  for (const [label, o] of [['the heel rolling up off the toe alone', { sway: 0, landShare: 1 }], ['that and a landing slower than the stance', { sway: 0 }], ['that and the hips\' sway', { landShare: 1 }]] as const) {
    const clip = strideWalk(bones, { speed: 1, ...o });
    const now = analyzeClip(clip, bones).speed;
    const was = old ? old.analyzeClip(clip, bones).speed : null;
    ok(Math.abs(now - 1) < 0.005 && (was === null || Math.abs(was - 1) > 0.02), `with ${label}: ${now.toFixed(4)} m/s${was !== null ? `, where the measure before read ${was.toFixed(3)}` : ''}`);
  }
  // Every stance says how fast it went. Spans of a foot (frame f to f + 1) laid out by hand: a stance whose spans are
  // still keeps exactly those; one none of whose spans is still (a foot that lands and at once rolls its heel up) keeps
  // its stillest span near the ground; a span not near the ground is never kept; and in a loop a stance over the seam is
  // one stance. `on` is the planted frames (a loop's last frame is its first).
  {
    const F = false, T = true;
    // Stances (spans between two planted frames): 4-5, 9-10, and 13-0 over the seam.
    const on = [T, T, F, F, T, T, T, F, F, T, T, T, F, T];
    const near = Float64Array.from([1, 0, 0, 0, 1, 0.5, 0, 0, 0, 1, 0, 0, 0, 1]);
    const rise = Float64Array.from([0.4, 0, 0, 0, 0.1, 0.1, 0, 0, 0, 0.35, 0.25, 0, 0, 0.3]);
    const kept = (s: Float64Array) => [...s].map((w, f) => (w > 0 ? `${f}:${w}` : '')).filter(Boolean).join(' ');
    const loop = kept(settledShares(on, near, rise, on.length, true, 0.2));
    ok(loop === '4:1 5:0.5 9:1 13:1', `a stance's still spans are its middle (4, and 5 for the half of it near the ground); a stance with none keeps its stillest near the ground (9, never 10, stiller but not near it); and in a loop a stance over the seam is one stance, keeping the stiller of its two (13 of 13 and 0): kept ${loop}`);
    // A clip that does not loop has a span fewer than frames, and none over its end.
    const plain = kept(settledShares(on, near.subarray(0, 13), rise.subarray(0, 13), on.length, false, 0.2));
    ok(plain === '0:1 4:1 5:0.5 9:1', `in a clip that does not loop, a stance at its start is a stance of its own and keeps its span (0): kept ${plain}`);
  }
}

// ---- loops and one-offs -----------------------------------------------------------------------------------------------
{
  const oneOff = makeClip(bones, 21, 0.7, (_b, t) => qaxis(1, 0, 0, t), (t) => [0, -t, 0]);
  const a = analyzeClip(oneOff, bones);
  ok(!a.loop && a.endAngle > 30 && Math.abs(a.travelNet[1] + 0.7) < 1e-6, 'a clip that ends turned from where it began is no loop');
  const sinks = makeClip(bones, 21, 0.7, () => [0, 0, 0, 1], (t) => [0, -0.2 * t, 0]);
  ok(!analyzeClip(sinks, bones).loop, 'nor is one that ends at another height, pose for pose though it ends as it began (a stair)');
  const drifts = makeClip(bones, 21, 0.7, () => [0, 0, 0, 1], (t) => [0.6 * t, 0, t]);
  ok(analyzeClip(drifts, bones).loop, 'but one that only travels level is');
  const nearly = makeClip(bones, 21, 0.7, (_b, t) => qaxis(0, 1, 0, (t / 0.7) * (ANALYZE.loopAngle - 1) * (Math.PI / 180)));
  ok(analyzeClip(nearly, bones).loop, `a clip whose end is within ${ANALYZE.loopAngle} degrees of its beginning loops`);
}

// ---- a planted spell's noise -------------------------------------------------------------------------------------------
{
  const T = true, F = false;
  const run = (flags: boolean[], cyclic: boolean) => settle(flags, 4, 2, cyclic).map((v: boolean) => (v ? 'x' : '.')).join('');
  ok(run([F, F, F, F, T, T, T, F, F, T, T, T, F, F, F, F], false) === '....xxxxxxxx....', 'a foot lifted for two frames in the middle of a plant never left the ground');
  ok(run([F, F, F, F, F, T, F, F, F, F, F, F], false) === '............', 'and one down for a single frame never came down');
  ok(run([T, T, F, F, F, F, F, F, T, T, T, T], false) === 'xx......xxxx', 'a real lift is kept');
  ok(run([T, F, F, T, T, T, T, T, F, F, F, F, F, T], true) === 'xxxxxxxx.....x' && run([T, F, F, T, T, T, T, T, F, F, F, F, F, T], false) === 'xxxxxxxx.....x', 'a short lift is filled whether or not the clip loops');
  ok(run([F, T, T, T, T, F, F, F, F, F, F, F], true) === '.xxxx.......' && run([F, F, T, T, T, T, T, T, T, T, T, F], true) === 'xxxxxxxxxxxx', 'in a loop a lift over the seam is one lift: two frames of it are filled');
  ok(run([F, F, T, T, T, T, T, T, T, T, T, F], false) === '..xxxxxxxxx.', 'and in a one-off a lift at either end is left as it is, since nothing says how long it was');
}

// ---- names -------------------------------------------------------------------------------------------------------------
{
  ok(slug('Falling Flat Impact') === 'falling_flat_impact' && slug('Walking (1)') === 'walking_1' && slug('  Jump--To  Hang ') === 'jump_to_hang', 'a file\'s id is its name in lower case, every run of anything else one underscore');
  ok(slug === clipSlug, 'by the game\'s own rule, so the console finds a clip by its file\'s name');
  const ids = idsFor(['Hanging Idle.fbx', 'Parkour/Braced/Hanging Idle.fbx', 'Parkour/Free hang/Hanging Idle.fbx', 'Parkour/Free hang/Left Shimmy.fbx', 'Left Shimmy.fbx', 'Walking.fbx']);
  ok(ids.get('Hanging Idle.fbx') === 'hanging_idle' && ids.get('Parkour/Braced/Hanging Idle.fbx') === 'braced_hanging_idle' && ids.get('Parkour/Free hang/Hanging Idle.fbx') === 'free_hang_hanging_idle', 'where two files share a name, the ones in a folder take the folder\'s in front');
  ok(ids.get('Parkour/Free hang/Left Shimmy.fbx') === 'free_hang_left_shimmy' && ids.get('Left Shimmy.fbx') === 'left_shimmy' && ids.get('Walking.fbx') === 'walking', 'and a name nobody shares stays as it is');
  const deep = idsFor(['A/X/Clip.fbx', 'B/X/Clip.fbx']);
  ok(deep.get('A/X/Clip.fbx') === 'a_x_clip' && deep.get('B/X/Clip.fbx') === 'b_x_clip', 'a folder that is not enough takes the one above it too');
  assert.throws(() => idsFor(['A b.fbx', 'a_b.fbx']), /both make the id/, 'two files that make one id whatever is put in front are refused');
  checks++;
}

// ---- the table ---------------------------------------------------------------------------------------------------------
{
  const allowed = new Set(['use', 'loop', 'trimStart', 'mirror', 'ground', 'level']);
  ok(Object.values(CLIPS).every((r) => Object.keys(r as object).every((k) => allowed.has(k))), 'every row of the table says only what the importer reads');
  const used = Object.entries(CLIPS).filter(([, r]) => (r as { use?: boolean }).use).map(([id]) => clipName(id)).sort();
  ok(JSON.stringify(used) === JSON.stringify([...Object.values(MX), ...tableClips().filter((id) => !id.endsWith('_mirrored')).map(clipName)].sort()), 'the clips the table marks for the game are the ones the game\'s rules name and the ones the speed classes\' table names (a mirrored twin is marked with the clip it mirrors)');
  ok(rowFor('falling_flat_impact').trimStart === 0.38 && rowFor('falling_to_landing').trimStart === 0.233 && rowFor('hard_landing').trimStart === 0.533, 'the brief\'s three trims, counted at thirty frames a second: 0.38, 0.233 and 0.533 s');
  ok(Object.entries(ANIM_TUNE_SHIPPED.trim).every(([id, t]) => rowFor(id).trimStart === t), 'and each is the tune\'s own start');
  ok(['jog_strafe_left', 'left_strafe', 'jog_forward_diagonal', 'jog_backward_diagonal'].every((id) => rowFor(id).mirror) && Object.entries(CLIPS).filter(([, r]) => (r as { mirror?: boolean }).mirror).length === 4, 'four clips are mirrored: the two strafes and the two diagonals the brief asks for');
  ok(JSON.stringify(rowFor('nobody_named_this')) === JSON.stringify(CLIP_DEFAULTS) && rowFor('treading_water').ground === false && rowFor('floating').level === true && rowFor('walking').ground === true, 'a clip the table does not name takes the defaults: not used, not trimmed, not mirrored, on the ground');
}

// ---- the reader, on a source file made here ------------------------------------------------------------------------------
// (animFbxFixture.ts writes the file's text; three's own loader reads it, as it reads the real ones.)
const yTurn = (deg: number) => qaxis(0, 1, 0, deg * DEG);
{
  // Five bones, one of them an end joint the take does not turn; the spine rests a quarter turn round, so a turn
  // away from rest taken in the wrong order comes out about another axis. Eight keys at sixty a second: the hips
  // turn ten degrees a key about the vertical and move, the left leg seventy a key about its own axis (past a whole
  // turn, so its rotations change sign on the way), the spine and the right leg hold their rest.
  const small: FbxBone[] = [
    { name: 'Hips', parent: null, local: [0, 100, 0] },
    { name: 'Spine', parent: 'Hips', local: [0, 10, 0], rest: [0, 0, 90] },
    { name: 'HeadTop_End', parent: 'Spine', local: [0, 20, 0] },
    { name: 'LeftUpLeg', parent: 'Hips', local: [9, -7, 0] },
    { name: 'RightUpLeg', parent: 'Hips', local: [-9, -7, 0] },
  ];
  const take: FbxTake = {
    keys: 8,
    turn: (b, k) => (b === 'Hips' ? [0, 10 * k, 0] : b === 'Spine' ? [0, 0, 90] : b === 'LeftUpLeg' ? [70 * k, 0, 0] : b === 'RightUpLeg' ? [0, 0, 0] : null),
    move: (k) => [5 * k, 100 + k, 2 * k],
  };
  const read = readFbx(Buffer.from(fbxText(small, take)));
  ok(read.source.bones === 5 && read.source.frames === 8 && read.source.fps === 60 && Math.abs(read.source.duration - 7 / 60) < 1e-6, 'a file\'s own facts are read off it: five bones, eight keys at sixty a second, seven sixtieths of a second');
  ok(read.bones.map((b: { name: string }) => b.name).join() === 'Hips,LeftUpLeg,RightUpLeg,Spine' && read.bones.map((b: { parent: number }) => b.parent).join() === '-1,0,0,0', 'the pack\'s bones are the ones the take turns (an end joint is left out), parent first, a bone\'s children by name, the source\'s prefix taken off');
  const other = readFbx(Buffer.from(fbxText(small, take, { order: ['Spine', 'HeadTop_End', 'RightUpLeg', 'Hips', 'LeftUpLeg'] })));
  ok(restDifference(read, other) === '' && other.bones.map((b: { name: string }) => b.name).join() === 'Hips,LeftUpLeg,RightUpLeg,Spine', 'whichever order the file lists its skeleton in (the source\'s files list it more than one way)');
  const rests = read.bones.map((b: { rest: number[] }) => b.rest.map((v) => v.toFixed(4)).join(' ')).join(' | ');
  ok(rests === '0.0000 1.0000 0.0000 | 0.0900 0.9300 0.0000 | -0.0900 0.9300 0.0000 | 0.0000 1.1000 0.0000', `the file's centimetres are the pack's metres (${rests})`);
  ok(qangle(read.restQ[3], qaxis(0, 0, 1, 90 * DEG)) < 1e-3 && qangle(read.restQ[0], [0, 0, 0, 1]) < 1e-3, 'and each bone\'s rest turn is read with its rest place');
  const c = read.clip;
  // Seven sixtieths of a second at thirty a second is three and a half frames: rounded, and one more for the last.
  ok(c.frames === 5 && c.bones === 4 && Math.abs(c.duration - 7 / 60) < 1e-6 && c.quats.length === 5 * 4 * 4 && c.travel.length === 15, 'the take is sampled at the pack\'s rate, evenly from its first moment to its last: five frames of it');
  let hips = 0, spine = 0, leg = 0, other2 = 0, travel = 0, least = 1;
  for (let f = 0; f < c.frames; f++) {
    // Frame f stands at f quarters of the take: 1.75 keys a frame.
    const turn = yTurn(17.5 * f);
    hips = Math.max(hips, qangle(at4(c.quats, f * 4), turn));
    spine = Math.max(spine, qangle(at4(c.quats, f * 4 + 3), turn));
    leg = Math.max(leg, qangle(at4(c.quats, f * 4 + 1), qmul(turn, qaxis(1, 0, 0, 122.5 * f * DEG))));
    other2 = Math.max(other2, qangle(at4(c.quats, f * 4 + 2), turn));
    travel = Math.max(travel, Math.abs(c.travel[f * 3] - 0.0875 * f), Math.abs(c.travel[f * 3 + 1] - 0.0175 * f), Math.abs(c.travel[f * 3 + 2] - 0.035 * f));
    if (f > 0) for (let b = 0; b < 4; b++) least = Math.min(least, at4(c.quats, f * 4 + b).reduce((s, v, i) => s + v * c.quats[((f - 1) * 4 + b) * 4 + i], 0));
  }
  ok(hips < 0.02 && other2 < 0.02, `each frame's hips are turned from rest as arithmetic says, 17.5 degrees a frame, and a leg that holds its rest goes round with them (worst ${hips.toFixed(4)} degrees)`);
  ok(qangle(at4(c.quats, 16), yTurn(70)) < 0.02 && qangle(at4(c.quats, 16), at4(c.quats, 0)) > 60, 'the last frame is the take\'s own end, seventy degrees round, and not its beginning again (a repeating take asked for exactly its end answers with its start)');
  ok(spine < 0.02 && qangle(at4(c.quats, 16 + 3), qaxis(1, 0, 0, 70 * DEG)) > 60, `a bone's turn is its world turn times its rest's inverse, in that order: the spine, resting a quarter turn round and riding the hips, is turned exactly as they are (worst ${spine.toFixed(4)} degrees), where the other order turns it about another axis`);
  ok(leg < 0.1, `a bone turning under a turning parent carries both (the leg, worst ${leg.toFixed(3)} degrees)`);
  ok(least > 0, `and every bone's frames are written with one sign, through more than a whole turn (least dot ${least.toFixed(3)})`);
  // (The last frame is sampled a hundred-thousandth of a second short of the end: three hundredths of a millimetre here.)
  ok(travel < 1e-4 && c.travel[12] > 0.34 && c.travel[14] > 0.13, `the hips' travel is their place less their rest place, in metres, with its signs (worst ${travel.toExponential(1)} m off)`);
  const moved = small.map((b) => (b.name === 'LeftUpLeg' ? { ...b, local: [9, -9, 0] as [number, number, number] } : b));
  ok(/LeftUpLeg rests 2\.00 cm away/.test(restDifference(read, readFbx(Buffer.from(fbxText(moved, take))))), 'two files whose rest poses differ are told apart, by the bone and how far');
  assert.throws(() => readFbx(Buffer.from(fbxText(small, { keys: 4, turn: () => null, move: (k) => [k, 100, 0] }))), /turns no bone/, 'a take that turns no bone is refused');
  checks++;
}

// ---- the importer, on a folder of source files made here -------------------------------------------------------------------
{
  // The tests' own source skeleton as a file's bones, and its walk as a take: the same rule `walkClip` makes its
  // clip by, written as each leg's local turns at sixty keys a second.
  const fb = fbxBonesOf(bones);
  const walkTake = (axis: 'x' | 'z', keys = 61, lift = 0): FbxTake => ({
    keys,
    turn: (bone, k) => {
      const side = bone.startsWith('Left') ? 0 : bone.startsWith('Right') ? Math.PI : null;
      const t = k / 60;
      if (side === null || !/(UpLeg|Leg)$/.test(bone)) return [0, 0, 0];
      const swing = (0.4 * Math.sin(2 * Math.PI * t + side)) / DEG;
      if (/UpLeg$/.test(bone)) return axis === 'x' ? [swing, 0, 0] : [0, 0, swing];
      const forward = (axis === 'x' ? -1 : 1) * Math.cos(2 * Math.PI * t + side);
      return [(0.9 * Math.max(0, forward)) / DEG, 0, 0];
    },
    move: lift ? () => [0, 100 + lift, 0] : undefined,
  });
  const src = mkdtempSync(join(tmpdir(), 'anims-src-'));
  const out = mkdtempSync(join(tmpdir(), 'anims-out-'));
  try {
    const put = (rel: string, text: string) => {
      mkdirSync(join(src, rel, '..'), { recursive: true });
      writeFileSync(join(src, rel), text);
    };
    put('Walking.fbx', fbxText(fb, walkTake('x')));
    put('Parkour/Braced/Walking.fbx', fbxText(fb, walkTake('x'), { order: [...fb].reverse().map((b) => b.name) }));
    // Two thirds of a cycle: it does not end as it began, and the table says it loops all the same; and it has feet
    // on a ground the table says is not there.
    put('Treading Water.fbx', fbxText(fb, walkTake('x', 41)));
    put('Left Strafe.fbx', fbxText(fb, walkTake('z')));
    put('Floating.fbx', fbxText(fb, { keys: 31, turn: () => [0, 0, 0], move: (k) => [0, 133 + 2 * Math.sin((k / 30) * 2 * Math.PI), 0] }));
    put('Hard Landing.fbx', fbxText(fb, { keys: 61, turn: (b, k) => (b === 'Spine' ? [k, 0, 0] : [0, 0, 0]), move: (k) => [0, 100 - 0.5 * k, 0.4 * k] }));
    put('Odd Rest.fbx', fbxText(fb.map((b) => (b.name === 'Spine' ? { ...b, local: [0, 13, 0] as [number, number, number] } : b)), walkTake('x')));
    put('notes.txt', 'not a source file');
    writeFileSync(join(out, 'left_over.mxa'), 'a clip the folder no longer gives');
    writeFileSync(join(out, 'kept.txt'), 'not a clip');
    const before = readdirSync(src, { recursive: true }).length;
    assert.throws(() => importFolder(src, join(src, 'pack')), /never written into/, 'the importer refuses to write into the folder it reads');
    checks++;
    const result = importFolder(src, out);
    ok(readdirSync(src, { recursive: true }).length === before, 'an import leaves the folder it reads as it found it');
    const index = readPackIndex(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')));
    if (typeof index === 'string') throw new Error(index);
    const row = (id: string) => index.clips.find((r) => r.id === id)!;
    const clipOf = (id: string) => decodeMxa(readFileSync(join(out, `${id}.mxa`)));
    ok(result.files === 7 && result.failed.length === 0 && index.clips.map((r) => r.id).sort().join() === 'braced_walking,floating,hard_landing,left_strafe,left_strafe_mirrored,treading_water,walking', `seven files read, six of them on one rest pose, and seven clips written by their files' names (${index.clips.map((r) => r.id).join(', ')})`);
    ok(result.restDiffers.length === 1 && result.restDiffers[0].file === 'Odd Rest.fbx' && /Spine rests 3\.00 cm away/.test(result.restDiffers[0].why) && !existsSync(join(out, 'odd_rest.mxa')), 'the file whose rest pose is not the first\'s is left out, and named with why');
    ok(index.bones.length === bones.length && index.bones[0].name === 'Hips' && index.bones.every((b) => Math.hypot(...b.rest.map((v, i) => v - bones.find((s) => s.name === b.name)!.rest[i])) < 1e-5), 'the index carries the skeleton the files share: every bone by its name, at its rest place in metres');
    ok(readdirSync(out).sort().join() === ['index.json', 'kept.txt', ...index.clips.map((r) => r.file)].sort().join() && result.stale.join() === 'left_over.mxa', 'a clip the folder no longer gives is taken away, and nothing else in the pack\'s folder is touched');
    // A walk through the whole importer: the reader's samples are the rule's own clip.
    const walking = clipOf('walking'), rule = walkClip(bones);
    let worst = 0;
    for (let f = 0; f < rule.frames; f++) for (const [i, b] of index.bones.entries()) worst = Math.max(worst, qangle(at4(walking.quats, f * walking.bones + i), at4(rule.quats, f * rule.bones + bones.findIndex((s) => s.name === b.name))));
    ok(walking.frames === rule.frames && worst < 0.5, `a walk written as a file and imported is the walk made by rule, frame for frame and bone for bone (worst ${worst.toFixed(3)} degrees)`);
    const top = walkTopSpeed(bones);
    ok(row('walking').loop && row('walking').feet.length === 2 && row('walking').feet[0].foot === 'R' && row('walking').speed > 0.7 * top && Math.abs(row('walking').heading) < 2 && !row('walking').use && row('walking').trimStart === 0 && row('walking').source === 'Walking.fbx' && row('braced_walking').source === 'Parkour/Braced/Walking.fbx', 'its row says what was measured of it: a loop, two foot marks with the right foot first, its speed and heading, and the file it came from; a clip the table does not name is not for the game');
    // The table over the measurement.
    const tread = row('treading_water');
    ok(!analyzeClip(clipOf('treading_water'), index.bones).loop && tread.loop && tread.use, 'a clip the table calls a loop is one, though it does not end as it began');
    ok(tread.feet.length === 0 && tread.speed === 0 && analyzeClip(clipOf('treading_water'), index.bones).feet.length > 0, 'and one the table says has no ground under it has no foot marks and no speed, though its feet come down');
    ok(row('hard_landing').trimStart === 0.533 && !row('hard_landing').loop && row('hard_landing').use && Math.abs(row('hard_landing').travelNet[1] + 0.3) < 1e-3 && Math.abs(row('hard_landing').travelNet[2] - 0.24) < 1e-3, 'a clip the table trims carries its trim, and its hips\' net travel is recorded as it was');
    ok(Math.abs(row('floating').level! - 0.33) < 0.002 && row('floating').loop && row('walking').level === undefined, `a clip the table levels carries how high its hips ride on average (${row('floating').level} m)`);
    // The mirrored twin.
    const left = row('left_strafe'), twin = row('left_strafe_mirrored');
    ok(Math.abs(left.heading - 90) < 3 && Math.abs(twin.heading + 90) < 3 && Math.abs(left.speed - twin.speed) < 1e-3 && twin.mirrorOf === 'left_strafe' && left.mirrorOf === undefined && twin.use === left.use && twin.source === 'Left Strafe.fbx', `a clip the table mirrors has a twin beside it, measured afresh: it goes the other way (${left.heading} and ${twin.heading} degrees) at the same speed`);
    ok(left.feet.length === 2 && twin.feet.length === 2 && left.feet.every((m, i) => twin.feet[i].foot !== m.foot && Math.abs(twin.feet[i].t - m.t) < 1e-9), 'each of its feet coming down when the other one did');
    const names = index.bones.map((b) => b.name);
    const want = mirrorClip(clipOf('left_strafe'), names), got = clipOf('left_strafe_mirrored');
    let off = 0;
    for (let i = 0; i < want.quats.length; i += 4) off = Math.max(off, qangle([want.quats[i], want.quats[i + 1], want.quats[i + 2], want.quats[i + 3]], [got.quats[i], got.quats[i + 1], got.quats[i + 2], got.quats[i + 3]]));
    ok(off < 0.02 && got.frames === want.frames && twin.hash !== left.hash, `and its file is its original's mirror image (worst ${off.toFixed(4)} degrees)`);
    const lines = reportLines(result, out);
    ok(lines.some((l) => /Left out, their rest pose is not the first file's/.test(l)) && lines.some((l) => /Odd Rest\.fbx/.test(l)) && lines.some((l) => /hard_landing: from 0\.533 s the foot stands/.test(l)) && lines.some((l) => /floating: rides 0\.33 m over its rest height/.test(l)) && lines.some((l) => /Taken away, no file gives them any more: left_over\.mxa/.test(l)), 'the report says all of it in words: who was left out, where a trimmed one-off\'s feet are, what was levelled, what was taken away');
    // The same folder again writes the same pack.
    const first = readFileSync(join(out, 'index.json'), 'utf8');
    const bytes = index.clips.map((r) => readFileSync(join(out, r.file)));
    importFolder(src, out);
    ok(readFileSync(join(out, 'index.json'), 'utf8') === first && index.clips.every((r, i) => readFileSync(join(out, r.file)).equals(bytes[i])), 'and the same folder imported again writes the same pack, byte for byte');
  } finally {
    rmSync(src, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
}

// ---- the committed pack against the table, with no source files -----------------------------------------------------------
// (A row of the table changed and the pack not imported again is a pack that no longer says what the table says: caught
// here on any machine, where the comparison with a fresh import below needs the source folder.)
{
  const index = readPackIndex(JSON.parse(readFileSync(join(repoRoot(import.meta.url), 'public', 'anims', 'mixamo', 'index.json'), 'utf8')));
  if (typeof index === 'string') throw new Error(index);
  const own = index.clips.filter((r) => !r.mirrorOf);
  const twins = new Set(index.clips.filter((r) => r.mirrorOf).map((r) => r.mirrorOf));
  const off: string[] = [];
  for (const r of own) {
    const t = rowFor(r.id) as { use: boolean; loop?: boolean; trimStart: number; mirror: boolean; ground: boolean; level: boolean };
    if (t.loop !== undefined && r.loop !== t.loop) off.push(`${r.id} loop`);
    if (!t.ground && (r.feet.length > 0 || r.speed !== 0)) off.push(`${r.id} ground`);
    if (r.trimStart !== t.trimStart) off.push(`${r.id} trim`);
    if (r.use !== t.use) off.push(`${r.id} use`);
    if (t.level !== (r.level !== undefined)) off.push(`${r.id} level`);
    if (t.mirror !== twins.has(r.id)) off.push(`${r.id} mirror`);
  }
  const unnamed = Object.keys(CLIPS).filter((id) => !own.some((r) => r.id === id));
  ok(off.length === 0 && unnamed.length === 0, `the committed pack says what the table says of every clip (its loops, its trims, what has no ground, what is levelled, mirrored and used), and every row of the table names a clip of it${off.length || unnamed.length ? `: ${[...off, ...unnamed.map((id) => `${id} not in the pack`)].join(', ')}` : ''}`);
}

// ---- the committed pack against a fresh import, where the source is on this machine ------------------------------------
/** The last commit whose clips (the `.mxa` files) were made anew: move it when they are. */
const MXA_AT = '91e62d9';
/**
 * Each named clip file as MXA_AT committed it, or null where git cannot hand them over. Climbing II, phase 3: a clip MXA_AT did
 * not have (one a later import added: the owner's Swinging and Injured Pack folders) is left out of the map, never a reason to
 * compare none (git's list of MXA_AT's files says which it had).
 */
function mxaAt(files: readonly string[]): Map<string, Buffer> | null {
  if (process.env.SWG3JS_NO_OLD === '1') return null;
  const out = new Map<string, Buffer>();
  try {
    const cwd = repoRoot(import.meta.url);
    const had = new Set(execFileSync('git', ['ls-tree', '--name-only', `${MXA_AT}:public/anims/mixamo/`], { cwd, maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/).filter(Boolean));
    for (const n of files) if (had.has(n)) out.set(n, execFileSync('git', ['show', `${MXA_AT}:public/anims/mixamo/${n}`], { cwd, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
  return out;
}
{
  const src = process.env.SWG3JS_MIXAMO_FBX;
  const root = repoRoot(import.meta.url);
  const packDir = join(root, 'public', 'anims', 'mixamo');
  if (!src || !existsSync(src)) note('SWG3JS_MIXAMO_FBX names no folder of source files: the committed pack is not held to a fresh import here');
  else {
    assert.throws(() => importFolder(src, join(src, 'out')), /never written into/, 'the importer refuses to write into the folder it reads');
    checks++;
    const out = mkdtempSync(join(tmpdir(), 'anims-'));
    try {
      const before = readdirSync(src, { recursive: true }).length;
      const result = importFolder(src, out);
      ok(readdirSync(src, { recursive: true }).length === before, 'an import leaves the folder it reads as it found it');
      // Climbing II, phase 3: a file three's FBX reader cannot read (two of the owner's Injured Pack downloads, "Unknown property
      // type", 2026-11-18) makes no clip and is said; it may never be a clip the committed pack holds.
      const kept0 = JSON.parse(readFileSync(join(packDir, 'index.json'), 'utf8')) as { clips: { source?: string }[] };
      const keptSources = new Set(kept0.clips.map((c) => c.source).filter((s): s is string => !!s));
      const failedIn = result.failed.filter((f: { file: string }) => keptSources.has(f.file.replace(/\\/g, '/')));
      if (result.failed.length) note(`${result.failed.length} source file(s) could not be read and make no clip: ${result.failed.map((f: { file: string; why?: string; error?: string }) => `${f.file} (${f.why ?? f.error ?? ''})`).join('; ')}`);
      ok(failedIn.length === 0 && result.restDiffers.length === 0 && result.tableUnused.length === 0, `every one of the ${result.files} source files whose clip the pack holds is read, on one rest pose, and every row of the table names one`);
      const fresh = readFileSync(join(out, 'index.json'), 'utf8');
      const kept = readFileSync(join(packDir, 'index.json'), 'utf8').replace(/\r\n/g, '\n');
      ok(fresh === kept, 'a fresh import writes the committed index, word for word');
      const files = readdirSync(out).filter((n) => n.endsWith('.mxa'));
      ok(files.length === result.index.clips.length && files.every((n) => readFileSync(join(out, n)).equals(readFileSync(join(packDir, n)))), `and its ${files.length} clip files byte for byte`);
      // The clips themselves were last made anew at MXA_AT: a measure mended since moves the index and never a clip.
      const was = mxaAt(files);
      if (was) {
        const added = files.filter((n) => !was.has(n));
        ok(was.size > 0 && [...was.keys()].every((n) => was.get(n)!.equals(readFileSync(join(out, n)))), `each of the ${was.size} clips ${MXA_AT} committed byte for byte as it committed it`);
        if (added.length) note(`${added.length} clip(s) ${MXA_AT} had not (added by a later import): ${added.join(', ')}`);
      } else note(`git cannot hand over ${MXA_AT}'s clips here: they are not compared`);
      const lines = reportLines(result, out);
      // Climbing II, phase 3: a clip a later import added (the Injured Pack's loops, for a later limp pass that has not looked
      // at them) is said where its feet and hips part, and never holds the clips the game already plays to it.
      const newIds = new Set(was ? files.filter((n) => !was.has(n)).map((n) => n.replace(/\.mxa$/, '')) : []);
      const apart = lines.filter((l) => /more than \d+% apart/.test(l));
      const apartNew = apart.filter((l) => newIds.has(l.trim().split(':')[0]));
      if (apartNew.length) note(`clips added by a later import whose feet and hips part by more than ${TRAVEL_APART}%: ${apartNew.map((l) => l.trim()).join('; ')}`);
      ok(lines.some((l) => /sneak_walk: 2\.10 m in 1\.050 s/.test(l)) && apart.length === apartNew.length && lines.some((l) => /running_up_stairs: .*climbs 0\.48 m a cycle/.test(l)), `its report holds the level travelling clips' feet to their hips, none more than ${TRAVEL_APART}% apart, and says the one that climbs stairs stands on steps and is not held to its hips`);
      ok(lines.some((l) => /hard_landing: from 0\.533 s the foot stands/.test(l)) && lines.some((l) => /jumping_down: from 0\.000 s the foot stands 0\.43 m up; a foot comes down at 0\.24 s/.test(l)), 'and says where each one-off\'s feet are at its trim and when they come down');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }
}

console.log(`\n${checks} checks passed`);
