// The planted feet against the ground, as the game plays the speed classes' clips: every clip of the table (src/anim/
// locoTable.ts), from the committed pack, fitted to a skeleton by the pack as the game fits it (`MixamoPack.clipsFor`,
// the THREE clip the rig itself is handed) and played by a THREE mixer between its keys on a copy of the figure's
// bones at its size, at the rate the game gives it (`BodyLoco.legs` over the game's own rig, `CharacterRig`, whose
// speed for a clip is the pack's stride at the figure's size), with the body moved along the clip's own way at its
// pace's speed. Over each stance's settled middle (where the importer reads a clip's speed from, `analyzeClip`'s
// `middle`: parts of the spans between two frames, every stance of each foot keeping one), each foot's mean speed over
// the ground must be within 2% of the body's own, on three leg lengths: a human, the shortest figure a player can be
// (a Bothan woman at the least of her height) and the tallest (a Wookiee man at the most of his), on their own
// converted skeletons where the packs are on this machine and on the tests' own otherwise; the Ithorian, whose thigh is
// its own, is held to it over both feet and has each foot said. What no rate can take away, the wobble of a planted
// foot's speed within its stance (the source's own), is said, and so is the slip by a selection of the test's own (each
// foot's heel and toe near their lowest in the played pose, as the review measured it), which is not the importer's.
//
// `rig.ts` reaches the parts character, which node's type stripping refuses, and names modules without their
// extensions: served a stub and the extensions by the resolve hook `locoRig.test.ts` uses.
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
const { CLIP_HEADING, locoPick, tableClips } = await import('../../../src/anim/locoTable.ts');
const { LOCO_TUNE_SHIPPED } = await import('../../../src/anim/locoTune.ts');
const { decodeMxa, readPackIndex } = await import('../../../src/anim/mxaFile.ts');
const { planFit } = await import('../../../src/anim/fit.ts');
const { ALIGN_SHIPPED } = await import('../../../src/anim/mixamoMap.ts');
const { glbSkeleton, repoRoot, speciesBodies, targetSkeleton } = await import('./animFixtures.ts');
const { oldTexts } = await import('./oldModules.ts');
// @ts-expect-error the importer's own measure, plain JavaScript
const { ANALYZE, analyzeClip } = await import('../../anim/analyze.mjs');
type Tune = typeof LOCO_TUNE_SHIPPED;
type Target = ReturnType<typeof targetSkeleton>;
type Body = InstanceType<typeof BodyLoco>;
type Rig = InstanceType<typeof CharacterRig>;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
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
// The clips the pack fits to each skeleton, kept by name as the rig is handed them: what the game plays.
const played = new Map<string, THREE.AnimationClip>();
IMPORTED_CLIPS.provider = async (skeleton, label) => {
  const clips = await pack.clipsFor(skeleton, label);
  for (const c of clips) played.set(c.name, c);
  return clips;
};
IMPORTED_CLIPS.strides = (clip) => pack.strideOf(clip);

/** A skeleton as bones under a group. */
function bonesOf(target: Target): { group: THREE.Group; made: THREE.Bone[] } {
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
  return { group, made };
}

/** A group holding a skeleton as bones, and the game's own idle over it. */
function rigOf(target: Target): Rig {
  const { group } = bonesOf(target);
  const rest = target.joints[0];
  const idle = new THREE.AnimationClip('idle', 1, [new THREE.QuaternionKeyframeTrack(`${rest.name}.quaternion`, [0, 1], [...rest.restQ, ...rest.restQ])]);
  return CharacterRig.fromCharacter({ group, clips: [idle] } as never);
}

/** The first way, class and tiredness the table plays a clip at. */
function firstPick(id: string): { dir: number; cls: number; tired: boolean } {
  for (const tired of [false, true]) for (let cls = 1; cls <= 4; cls++) for (let dir = 0; dir < 8; dir++) if (locoPick(dir, cls, tired)?.id === id) return { dir, cls, tired };
  throw new Error(`the table never plays ${id}`);
}
const MOVE: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];

/**
 * A fresh body brought to a clip as the keys would bring it, a frame at a time: the walk key held for the walk, Shift
 * held for the run, let go and pressed again for the sprint, the pool emptied for the tired jog. Answers the body with
 * its pick, its speed and the rate its legs play at once the body moves at that speed.
 */
function bodyAt(rig: Rig, id: string, tune: Tune): Body {
  const { dir, cls, tired } = firstPick(id);
  const body = new BodyLoco(tune);
  const f = newLocoIn();
  f.dt = 1 / 60;
  f.sprint = tune.speed.forward.sprint;
  f.pool = tune.stamina.pool;
  [f.mz, f.mx] = MOVE[dir];
  const frame = (shift: boolean, pressed: boolean, walk: boolean) => {
    body.keys(1 / 60, shift, pressed, walk, rig);
    if (tired) {
      body.stamina.value = 0;
      body.stamina.tired = true;
    }
    body.plan(f);
  };
  if (cls === 1) frame(false, false, true);
  else if (cls === 2) frame(false, false, false);
  else {
    frame(true, true, false);
    for (let i = 0; i < 30; i++) frame(true, false, false);
    if (cls === 4) {
      for (let i = 0; i < 12; i++) frame(false, false, false);
      frame(true, true, false);
      for (let i = 0; i < 10; i++) frame(true, false, false);
    }
  }
  assert.ok(body.pick?.id === id, `${id}: the keys bring the body to it (got ${body.pick?.id})`);
  f.ground = body.speed;
  assert.ok(body.legs(rig, f, false)?.id === id, `${id}: and its legs play it`);
  return body;
}

/** One foot's mean speed along the clip's way over some stretch of it, metres a second of the clip's own time, and how long the stretch is. */
interface Along { along: number; time: number }
/** A clip's two feet as the game plays it: over the importer's settled middles, the pieces of them, and over the test's own selection. */
interface Feet { L: Along; R: Along; pieces: number[]; ownL: Along; ownR: Along }

/**
 * How a clip's feet go along its way as the game plays it on a figure: the clip the pack fitted to that skeleton and
 * handed the rig, played by a THREE mixer on a copy of the bones at the figure's size and read between its keys (each
 * joint turned smoothly from one key to the next, as the game draws it). Over the importer's own settled middles (each
 * span's settled part, from where it begins to where it ends between its two frames) each foot's mean along the way,
 * and the same over each quarter of a part (the wobble); and over a selection of the test's own, every 16th of a frame
 * where the played heel and toe are within the importer's settled height and rise of their lowest (scaled by the legs
 * and the figure), as the review measured it. In clip time, so any rate the game might play it at is one product away.
 */
function feetOf(id: string, target: Target, figure: number, stride: number): Feet {
  const r = row(id);
  const clip = played.get(`mx_${id}`);
  assert.ok(clip, `${id}: the pack fitted it to this skeleton`);
  const a = analyzeClip(decodeMxa(readFileSync(join(packDir, r.file))), index.bones);
  const { group, made } = bonesOf(target);
  group.scale.setScalar(figure);
  const mixer = new THREE.AnimationMixer(group);
  mixer.clipAction(clip).play();
  const T = clip.duration;
  const key = T / (r.frames - 1);
  const points = ['lAnkle', 'lToe', 'rAnkle', 'rToe'].map((n) => made.find((b) => b.name === n)!);
  const v = new THREE.Vector3();
  /** The four points at a moment of the clip (a loop's end is its start, so the very end is read a hair before it). */
  const at = (t: number, out = new Float64Array(12)): Float64Array => {
    mixer.setTime(Math.min(Math.max(0, t), T * (1 - 1e-9)));
    group.updateMatrixWorld(true);
    points.forEach((b, i) => {
      b.getWorldPosition(v);
      out[i * 3] = v.x;
      out[i * 3 + 1] = v.y;
      out[i * 3 + 2] = v.z;
    });
    return out;
  };
  // The body goes along the clip's own way in the figure's frame (0 forward, +Z; +90 left, +X): the body is turned from
  // the view by just what puts the clip's way on the travel.
  const h = ((CLIP_HEADING[id] ?? r.heading) * Math.PI) / 180;
  const ux = Math.sin(h), uz = Math.cos(h);
  const alongOf = (p0: Float64Array, p1: Float64Array, o: number) =>
    ((p1[o] - p0[o] + p1[o + 3] - p0[o + 3]) / 2) * ux + ((p1[o + 2] - p0[o + 2] + p1[o + 5] - p0[o + 5]) / 2) * uz;
  const pieces: number[] = [];
  const middle = (side: 'L' | 'R'): Along => {
    const o = side === 'L' ? 0 : 6;
    let d = 0, time = 0;
    for (const [f, from, to] of a.middle[side] as [number, number, number][]) {
      const t0 = (f + from) * key, t1 = (f + to) * key;
      d += alongOf(at(t0), at(t1), o);
      time += t1 - t0;
      for (let q = 0; q < 4; q++) {
        const s0 = t0 + ((t1 - t0) * q) / 4, s1 = t0 + ((t1 - t0) * (q + 1)) / 4;
        if (s1 > s0) pieces.push(alongOf(at(s0), at(s1), o) / (s1 - s0));
      }
    }
    return { along: time > 0 ? d / time : NaN, time };
  };
  const L = middle('L'), R = middle('R');
  // The test's own selection over the whole cycle.
  const N = (r.frames - 1) * 16;
  const P: Float64Array[] = [];
  for (let i = 0; i < N; i++) P.push(at((i * T) / N));
  const step = T / N;
  const own = (o: number): Along => {
    let lowA = Infinity, lowT = Infinity;
    for (const p of P) {
      lowA = Math.min(lowA, p[o + 1]);
      lowT = Math.min(lowT, p[o + 4]);
    }
    const near = ANALYZE.settledNear * stride * figure, still = ANALYZE.settledStill * stride * figure;
    let d = 0, n = 0;
    for (let i = 0; i < N; i++) {
      const p0 = P[(i + N - 1) % N], p = P[i], p1 = P[(i + 1) % N];
      if (p[o + 1] - lowA > near || p[o + 4] - lowT > near) continue;
      if (Math.abs(p1[o + 1] - p0[o + 1]) > 2 * step * still || Math.abs(p1[o + 4] - p0[o + 4]) > 2 * step * still) continue;
      d += alongOf(p0, p1, o) / (2 * step);
      n++;
    }
    return { along: n ? d / n : NaN, time: n * step };
  };
  return { L, R, pieces, ownL: own(0), ownR: own(6) };
}

/** A foot's slip at a rate: its mean speed over the ground as a share of the body's (nought is planted; + goes with the body). */
const slip = (x: Along, rate: number, ground: number) => (ground + rate * x.along) / ground;
/** Both feet's, over their time together. */
const both = (l: Along, r: Along, rate: number, ground: number) => (ground + (rate * (l.along * l.time + r.along * r.time)) / (l.time + r.time)) / ground;
const pc = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;

const root0 = speciesBodies(root);
const bodyFile = (id: string) => root0.find((b) => b.id === id)?.body;
/** `each`: every foot is held to 2% on its own (the three leg lengths); otherwise the two feet together, and each said. */
const bodies: { label: string; target: Target; figure: number; each: boolean }[] = [];
for (const [id, figure] of [['human_male', 1], ['bothan_female', 0.72], ['wookiee_male', 1.28]] as const) {
  const file = bodyFile(id);
  if (file) bodies.push({ label: `${id} at ${figure}`, target: glbSkeleton(file) as Target, figure, each: true });
}
if (bodies.length < 3) {
  note('no converted species on disk (assets-private/characters): the tests\' own skeleton stands in at the three heights');
  bodies.length = 0;
  for (const figure of [1, 0.72, 1.28]) bodies.push({ label: `the tests' skeleton at ${figure}`, target: targetSkeleton(), figure, each: true });
} else if (bodyFile('ithorian_male')) bodies.push({ label: 'ithorian_male at 1 (a thigh of its own)', target: glbSkeleton(bodyFile('ithorian_male')!) as Target, figure: 1, each: false });

// The pack as wave 2a left it (91e62d9), out of git where git can answer: its speeds, measured under the hips over every
// planted frame, and scaled by the hips' height, are the slip the owner was told of.
const OLD = '91e62d9';
const oldIndex = oldTexts(['public/anims/mixamo/index.json'], OLD);
const oldSpeed = oldIndex ? new Map((JSON.parse(oldIndex.get('public/anims/mixamo/index.json')!) as { clips: { id: string; speed: number }[] }).clips.map((c) => [c.id, c.speed])) : null;
if (!oldSpeed) note(`git cannot hand over ${OLD}'s index here: the slip before the mend is not measured`);

const tune = T();
ok(tune.rate.feet === 1, 'the feet\'s own dial stands at 1: the pack\'s speeds are what the feet do');
for (const b of bodies) {
  const rig = rigOf(b.target);
  await attachImportedClips(rig, b.label);
  rig.root.scale.setScalar(b.figure);
  const plan = planFit(index.bones, rig.restSkeleton(), ALIGN_SHIPPED);
  const lines: string[] = [];
  let worst = 0, worstId = '', worstFoot = 0, worstFootId = '', wobble = 0, wobbleId = '', control = 0, before = 0, beforeLeast = -Infinity;
  let ownWorst = 0, ownWorstId = '', ownFoot = 0, ownFootId = '';
  for (const id of tableClips()) {
    const body = bodyAt(rig, id, tune);
    const rate = body.rate, ground = body.speed;
    const s = feetOf(id, b.target, b.figure, plan.stride);
    // Every stance of each foot keeps a settled part to be read from: both feet of every clip are measured.
    assert.ok(s.L.time > 0 && s.R.time > 0, `${b.label}: ${id} has a settled middle for each foot (${s.L.time.toFixed(3)} and ${s.R.time.toFixed(3)} s of the clip)`);
    const l = slip(s.L, rate, ground), r = slip(s.R, rate, ground), lr = both(s.L, s.R, rate, ground);
    if (Math.abs(lr) > Math.abs(worst)) [worst, worstId] = [lr, id];
    for (const [x, foot] of [[l, 'L'], [r, 'R']] as const) if (Math.abs(x) > Math.abs(worstFoot)) [worstFoot, worstFootId] = [x, `${id} ${foot}`];
    const shares = s.pieces.map((p) => (ground + rate * p) / ground);
    const mean = shares.reduce((a, x) => a + x, 0) / shares.length;
    const spread = Math.sqrt(shares.reduce((a, x) => a + (x - mean) ** 2, 0) / shares.length);
    if (spread > wobble) [wobble, wobbleId] = [spread, id];
    // The test's own selection, the review's.
    const ol = slip(s.ownL, rate, ground), or = slip(s.ownR, rate, ground), olr = both(s.ownL, s.ownR, rate, ground);
    if (Math.abs(olr) > Math.abs(ownWorst)) [ownWorst, ownWorstId] = [olr, id];
    for (const [x, foot] of [[ol, 'L'], [or, 'R']] as const) if (Math.abs(x) > Math.abs(ownFoot)) [ownFoot, ownFootId] = [x, `${id} ${foot}`];
    // The control: the clip's speed scaled by the hips' height (`scale`, the rule before) instead of the legs'.
    const hipsRate = ground / (row(id).speed * plan.scale * b.figure);
    control = Math.min(control, both(s.L, s.R, hipsRate, ground));
    // Before the mend: 91e62d9's speed, scaled by the hips' height, held to the band as the game held it then.
    if (oldSpeed) {
      const r0 = ground / (oldSpeed.get(id)! * plan.scale * b.figure);
      const was = both(s.L, s.R, Math.min(tune.rate.max, Math.max(tune.rate.min, r0)), ground);
      before = Math.min(before, was);
      beforeLeast = Math.max(beforeLeast, was);
    }
    if (b.each) {
      assert.ok(Math.abs(l) < 0.02 && Math.abs(r) < 0.02, `${b.label}: ${id}'s planted feet go over the ground at ${pc(l)} (left) and ${pc(r)} (right) of the body's speed (each within 2%)`);
    }
    assert.ok(Math.abs(lr) < 0.02, `${b.label}: ${id}'s planted feet together go over the ground at ${pc(lr)} of the body's speed (within 2%)`);
    lines.push(`${id} L ${pc(l)} R ${pc(r)} both ${pc(lr)} (own selection L ${pc(ol)} R ${pc(or)}; wobble ${(spread * 100).toFixed(1)}%; rate ${rate.toFixed(3)})`);
  }
  checks += tableClips().length * (b.each ? 3 : 2);
  ok(true, `${b.label} (legs x${plan.stride.toFixed(4)}, hips x${plan.scale.toFixed(4)}): every one of the ${tableClips().length} table clips, played between its keys at the game's own rate, keeps ${b.each ? 'each of its feet' : 'its two feet together'} within 2% of the ground across their stances' settled middles (worst together ${worstId}, ${pc(worst)}; worst foot ${worstFootId}, ${pc(worstFoot)}: + is a foot going with the body)`);
  ok(control < -0.02, `and the control, the same clips' speeds scaled by the hips' height as before, slips back past 2% (${pc(control)} at its worst)`);
  if (oldSpeed) ok(before < -0.04, `before the mend (${OLD}'s speeds, scaled by the hips' height) the same feet slipped back by ${(-beforeLeast * 100).toFixed(1)} to ${(-before * 100).toFixed(1)}% of the body's speed`);
  note(`${b.label}: the wobble within a stance, the source's own and no rate's to take away: up to ${(wobble * 100).toFixed(1)}% of the body's speed (${wobbleId})`);
  note(`${b.label}: by the test's own selection (heel and toe near their lowest in the played pose, as the review measured; not the importer's middles): worst together ${ownWorstId} ${pc(ownWorst)}, worst foot ${ownFootId} ${pc(ownFoot)}`);
  note(`${b.label}: ${lines.join('; ')}`);
}
console.info = info;
console.log(`\n${checks} checks passed`);
