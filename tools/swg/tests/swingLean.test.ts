// Wave 2b of the animations, item F: the owner's "attacking while switching direction ... will sometimes lean too far
// back and attack over people rather than through them". After the polish round's spine mend (`jkaSpine`).
//
// The measure, on the converted human male's own rig (read only, the clips as the converter wrote them), through the
// game's own `CharacterRig` (the mixer, the split of a swing onto the upper body alone over the legs' state, the torso's
// twist, the jkaSpine mend as the rig makes it): a saber swing standing (the whole body) against the same swing over
// the back-pedal, the walk, the walk back and the run, the chest's lean (the line up from the top of the spine to the
// neck, + forward) and the reach (the shoulder to the hand's hold point, + up), and what each candidate does: the
// torso's quarter turn toward the view (a turn about the up axis), the movement (the legs' pelvis under the swing), and
// the mend. The cause found: the swing's spine keys are turns against the pelvis, so over the legs the whole upper
// body takes the legs' hips instead of the swing's own; Jedi Academy's medium and strong swings bend the hips 16 to 30
// degrees into the strike, the back-pedal 8.5 and a walk 13, so the swing stood further back and passed higher. The
// mend (`ANIM_TUNE.swingPelvis` 'mended') stands the swing's spine on its own pelvis; 'before' is 7424bad's to the bit,
// that commit's rig loaded out of git (a recorded digest for when git cannot answer). At 30, 60 and 144 frames a second,
// with a mutation of the mend shown to fail.
//
// `rig.ts` reaches the parts character, which node's type stripping refuses, and names modules without their
// extensions: served a stub and the extensions by the resolve hook `jkaSpine.test.ts` uses.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

const { CharacterRig } = await import('../../../src/player/rig.ts');
const { ANIM_TUNE } = await import('../../../src/anim/animTune.ts');
const { oldTexts, REPO } = await import('./oldModules.ts');
type Rig = InstanceType<typeof CharacterRig>;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const DEG = 180 / Math.PI;
const f1 = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
/** The commit wave 2b was built on (the polish round). */
const BEFORE_2B = '7424bad';
/** The digest of the rig's 'before' trace, recorded from 7424bad's own rig: what a checkout with no history is held to. */
const BEFORE_TRACE = 'fcf21c3c28230036';

// ---- the rig, read off the GLB (or a skeleton of ours) -----------------------------------------------------------------
interface Bone { name: string; parent: number; t: number[]; q: number[] }
function readRig(file: string, want: (n: string) => boolean): { bones: Bone[]; clips: THREE.AnimationClip[] } {
  const buf = readFileSync(file);
  const jlen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8'));
  const bin = buf.subarray(20 + jlen + 8);
  const nodes = gltf.nodes;
  const nameOf = (i: number) => nodes[i].extras?.name ?? nodes[i].name ?? `n${i}`;
  const parent = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((n: { children?: number[] }, i: number) => (n.children ?? []).forEach((c) => (parent[c] = i)));
  const joints: number[] = gltf.skins[0].joints;
  const index = new Map(joints.map((j, k) => [j, k]));
  const bones: Bone[] = joints.map((j) => ({ name: nameOf(j), parent: index.get(parent[j]) ?? -1, t: nodes[j].translation ?? [0, 0, 0], q: nodes[j].rotation ?? [0, 0, 0, 1] }));
  const acc = (i: number): Float32Array => {
    const a = gltf.accessors[i];
    const comps = a.type === 'SCALAR' ? 1 : a.type === 'VEC3' ? 3 : 4;
    const off = (gltf.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out = new Float32Array(a.count * comps);
    for (let k = 0; k < out.length; k++) out[k] = bin.readFloatLE(off + k * 4);
    return out;
  };
  const clips: THREE.AnimationClip[] = [];
  for (const a of gltf.animations) {
    if (!want(a.name)) continue;
    const tracks: THREE.KeyframeTrack[] = [];
    for (const ch of a.channels) {
      const s = a.samplers[ch.sampler];
      const name = nameOf(ch.target.node);
      if (ch.target.path === 'rotation') tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, acc(s.input), acc(s.output)));
      else if (ch.target.path === 'translation') tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, acc(s.input), acc(s.output)));
    }
    clips.push(new THREE.AnimationClip(a.name, -1, tracks));
  }
  return { bones, clips };
}
/** A rig of a class (today's or 7424bad's) over fresh bones and fresh copies of the clips. */
function makeRig(Cls: typeof CharacterRig, bones: Bone[], clips: THREE.AnimationClip[]): { rig: Rig; group: THREE.Group; at: Map<string, THREE.Bone> } {
  const group = new THREE.Group();
  const made: THREE.Bone[] = [];
  const at = new Map<string, THREE.Bone>();
  for (const b of bones) {
    const t = new THREE.Bone();
    t.name = b.name;
    t.position.fromArray(b.t);
    t.quaternion.fromArray(b.q);
    made.push(t);
    at.set(b.name, t);
    (b.parent < 0 ? group : made[b.parent]).add(t);
  }
  const rig = Cls.fromCharacter({ group, clips: clips.map((c) => c.clone()) } as never) as Rig;
  return { rig, group, at };
}

const charDir = join(REPO, 'assets-private', 'characters', 'human_male');
const onDisk = existsSync(join(charDir, 'rig.glb'));
const SWINGS = ['BOTH_A2_T__B_', 'BOTH_A3_TL_BR', 'BOTH_A2__L__R', 'BOTH_A1_T__B_'];
const LEGS: [string, string][] = [['runBack', 'BOTH_RUNBACK2'], ['walkBack', 'BOTH_WALKBACK2'], ['walkSaber', 'BOTH_WALK2'], ['runSaber', 'BOTH_RUN2']];

/** A skeleton and clips of the test's own: a pelvis, a three-joint spine, a neck, an arm and a hand. */
function ownRig(): { bones: Bone[]; clips: THREE.AnimationClip[] } {
  const names = ['root', 'spine1', 'spine2', 'spine3', 'neck', 'rArm', 'hold_r', 'lThigh'];
  const parents = [-1, 0, 1, 2, 3, 3, 5, 0];
  const t = [[0, 1, 0], [0, 0.1, 0], [0, 0.15, 0], [0, 0.15, 0], [0, 0.2, 0], [-0.2, 0.15, 0], [0, -0.6, 0.1], [0.1, -0.1, 0]];
  const bones = names.map((n, i) => ({ name: n, parent: parents[i], t: t[i], q: [0, 0, 0, 1] }));
  const pitch = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (deg * Math.PI) / 180).toArray();
  const quatTrack = (bone: string, degs: number[]) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, degs.map((_, i) => i * 0.25), degs.flatMap((d) => pitch(d)));
  const idle = new THREE.AnimationClip('idle', 1, [quatTrack('root', [0, 0])]);
  // A swing that bends the hips 25 degrees into its strike and lifts the arm, legs that tip the hips 8.
  const swing = new THREE.AnimationClip('BOTH_A2_T__B_', 1, [quatTrack('root', [5, 25, 25, 10, 5]), quatTrack('spine1', [0, 5, 5, 0, 0]), quatTrack('rArm', [-90, -40, 20, 0, 0])]);
  const back = new THREE.AnimationClip('BOTH_RUNBACK2', 1, [quatTrack('root', [8, 10, 8, 6, 8]), quatTrack('lThigh', [-20, 20, -20, 20, -20])]);
  return { bones, clips: [idle, swing, back] };
}

const { bones, clips } = onDisk ? readRig(join(charDir, 'rig.glb'), (n) => n === 'idle' || n === 'BOTH_STAND1' || SWINGS.includes(n) || LEGS.some(([, c]) => c === n)) : ownRig();
if (!onDisk) note('the human male rig is not on disk (assets-private/characters/human_male): measured on a skeleton of the test\'s own');

const v = new THREE.Vector3();
const w = new THREE.Vector3();
/** The chest's lean (the top of the spine to the neck, + forward) and the reach (shoulder to the hand's hold point, + up), degrees, in the figure's frame. */
function measure(at: Map<string, THREE.Bone>, group: THREE.Group): { chest: number; reach: number } {
  group.updateMatrixWorld(true);
  at.get('spine3')!.getWorldPosition(v);
  at.get('neck')!.getWorldPosition(w);
  const chest = Math.atan2(w.z - v.z, w.y - v.y) * DEG;
  at.get('rArm')!.getWorldPosition(v);
  at.get('hold_r')!.getWorldPosition(w);
  const reach = Math.atan2(w.y - v.y, Math.hypot(w.x - v.x, w.z - v.z)) * DEG;
  return { chest, reach };
}

/**
 * A swing played by a rig at `fps`: standing (the whole body: `legs` null) or over the legs' state (split onto the upper
 * body alone, as the player does on the move), the torso twisted by `twist` radians about the up axis each frame (the
 * quarter turn toward the view), measured every frame from a fifth of a second (the fades done) to the swing's end.
 */
function swingRun(Cls: typeof CharacterRig, swing: string, legs: string | null, fps: number, twist = 0, chained = true): { rows: { chest: number; reach: number }[]; trace: number[]; ends: number[] } {
  const { rig, group, at } = makeRig(Cls, bones, clips);
  const dt = 1 / fps;
  const trace: number[] = [];
  const step = () => {
    rig.update(dt);
    group.updateMatrixWorld(true);
    rig.twistTorso(twist, 0);
    for (const b of ['root', 'spine1', 'spine3', 'neck', 'rArm', 'hold_r']) {
      const q = at.get(b)!.quaternion;
      trace.push(q.x, q.y, q.z, q.w);
    }
  };
  rig.setState(legs ? (legs as never) : 'idle', legs ? 3 : 0);
  for (let i = 0; i < Math.round(0.3 * fps); i++) step();
  // Chained (the measure's case): a first swing split onto the upper body as a swing on the move is, the legs' own
  // halves settled under it, then the swing measured chained on (a combo while moving); else the swing begun on the move.
  if (chained) {
    // Held, so it stays on until the next is chained on (the saber machine chains a move before the last one ends).
    rig.play(swing, { fadeIn: 0.1, hold: true });
    if (legs) rig.overrideUpperOnly();
    for (let i = 0; i < Math.round(0.45 * fps); i++) step();
  }
  const seconds = rig.play(swing, { fadeIn: 0.05, upperOnly: !!legs }) ?? 0.3;
  if (legs && !chained) rig.overrideUpperOnly();
  const rows: { chest: number; reach: number }[] = [];
  // Every frame from the chained swing's fade (0.05 s) to the moment the rig lets it go (0.08 s before its end), and the
  // fifth of a second after (ends), the swing fading out.
  const ends: number[] = [];
  const n = Math.round((Math.min(seconds, 1.2) + 0.2) * fps);
  for (let i = 0; i < n; i++) {
    step();
    const t = (i + 1) * dt;
    if (t >= 0.05 - 1e-9 && t < seconds - 0.08 - 1e-9) rows.push(measure(at, group));
    if (t >= seconds - 0.08 - dt - 1e-9) ends.push(measure(at, group).chest);
  }
  return { rows, trace, ends };
}
const meanOf = (rows: { chest: number; reach: number }[], k: 'chest' | 'reach') => rows.reduce((a, r) => a + r[k], 0) / Math.max(1, rows.length);
const lowestReach = (rows: { chest: number; reach: number }[]) => Math.min(...rows.map((r) => r.reach));
const worstApart = (a: { chest: number; reach: number }[], b: { chest: number; reach: number }[]) => Math.max(...a.map((r, i) => Math.max(Math.abs(r.chest - b[i].chest), Math.abs(r.reach - b[i].reach))));

const swingsHere = SWINGS.filter((s) => clips.some((c) => c.name === s));
const legsHere = LEGS.filter(([, c]) => clips.some((x) => x.name === c));

/** The largest change of the chest's lean in one frame as a swing over each of the legs ends (the fade after it). */
function endStep(Cls: typeof CharacterRig, fps: number): number {
  let most = 0;
  for (const s of swingsHere) {
    for (const [state] of legsHere) {
      const e = swingRun(Cls, s, state, fps).ends;
      for (let i = 1; i < e.length; i++) most = Math.max(most, Math.abs(e[i] - e[i - 1]));
    }
  }
  return most;
}

// ---- the cause: over the legs the swing's upper body takes the legs' hips ------------------------------------------------
{
  ANIM_TUNE.swingPelvis = 'before';
  const lines: string[] = [];
  let worstBack = 0;
  let worstUp = 0;
  for (const s of swingsHere) {
    const stand = swingRun(CharacterRig, s, null, 60).rows;
    const parts = [`${s} standing: chest ${f1(meanOf(stand, 'chest'))}, lowest reach ${f1(lowestReach(stand))}`];
    for (const [state, clip] of legsHere) {
      const over = swingRun(CharacterRig, s, state, 60).rows;
      const dChest = meanOf(over, 'chest') - meanOf(stand, 'chest');
      const dReach = lowestReach(over) - lowestReach(stand);
      parts.push(`over ${clip}: chest ${f1(dChest)}, lowest reach ${f1(dReach)}`);
      if (/BACK|WALK/.test(clip) && !/A1_/.test(s)) {
        worstBack = Math.min(worstBack, dChest);
        worstUp = Math.max(worstUp, dReach);
      }
    }
    lines.push(parts.join('; '));
  }
  for (const l of lines) note(`'before' (7424bad): ${l}`);
  ok(worstBack < -8 && worstUp > 5, `'before': a medium or strong swing over the back-pedal or a walk stands its chest up to ${(-worstBack).toFixed(1)} degrees further back than the same swing standing, and its lowest reach passes up to ${worstUp.toFixed(1)} degrees higher: the owner's lean back`);
  // The quarter turn toward the view is a turn about the up axis: it moves nothing of the lean or the reach's height.
  const s = swingsHere[0];
  const flat = swingRun(CharacterRig, s, legsHere[0][0], 60, 0).rows;
  const turned = swingRun(CharacterRig, s, legsHere[0][0], 60, 0.6).rows;
  ok(worstApart(flat, turned.map((r, i) => ({ chest: flat[i].chest, reach: r.reach }))) < 0.05, `the torso's turn toward the view (0.6 rad about the up axis, as the quarter turn and the view's turn give it) leaves the reach's height where it was (worst ${worstApart(flat, turned.map((r, i) => ({ chest: flat[i].chest, reach: r.reach }))).toFixed(3)} degrees): it is not the cause`);
}

// ---- the mend: the swing's spine on its own pelvis --------------------------------------------------------------------------
for (const fps of [30, 60, 144]) {
  ANIM_TUNE.swingPelvis = 'mended';
  let worst = 0;
  for (const s of swingsHere) {
    const stand = swingRun(CharacterRig, s, null, fps).rows;
    for (const [state] of legsHere) worst = Math.max(worst, worstApart(stand, swingRun(CharacterRig, s, state, fps).rows));
  }
  ok(worst < 0.5, `'mended', at ${fps} frames a second: every swing over every one of the legs leans and reaches as it does standing (worst ${worst.toFixed(3)} degrees apart, frame for frame, its fades done)`);
  // And as each swing ends the chest goes back onto the legs over the swing's own fade, by no more a frame than the legs
  // and the swing move it themselves ('before''s own end).
  ANIM_TUNE.swingPelvis = 'before';
  const stepB = endStep(CharacterRig, fps);
  ANIM_TUNE.swingPelvis = 'mended';
  const stepM = endStep(CharacterRig, fps);
  ok(stepM < stepB + 6 * (60 / fps), `'mended', at ${fps} frames a second: as a swing over the legs ends, the chest goes back onto the legs' hips with no jump (at most ${stepM.toFixed(1)} degrees a frame, 'before' ${stepB.toFixed(1)})`);
}

// ---- 'before' is 7424bad's rig, to the bit ----------------------------------------------------------------------------------
async function loadRig(texts: Map<string, string>): Promise<typeof CharacterRig> {
  const dir = mkdtempSync(join(tmpdir(), 'swing-rig-'));
  const three = import.meta.resolve('three');
  const where = (f: string) => join(dir, f.replace(/\//g, '__'));
  try {
    for (const [f, src] of texts) {
      const from = resolve(REPO, f, '..');
      const point = (p: string): string => {
        const target = resolve(from, p).replace(/\\/g, '/');
        const own = [...texts.keys()].find((x) => resolve(REPO, x).replace(/\\/g, '/') === target || resolve(REPO, x).replace(/\\/g, '/') === `${target}.ts`);
        if (own) return pathToFileURL(where(own)).href;
        return pathToFileURL(resolve(from, /\.[a-z]+$/.test(p) ? p : `${p}.ts`)).href;
      };
      const out = src
        .replace(/from 'three'/g, `from '${three}'`)
        .replace(/from 'three\/([^']+)'/g, (_m, p: string) => `from '${import.meta.resolve(`three/${p}`)}'`)
        .replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${point(p)}'`);
      writeFileSync(where(f), out);
    }
    return ((await import(pathToFileURL(where('src/player/rig.ts')).href)) as { CharacterRig: typeof CharacterRig }).CharacterRig;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  const old = oldTexts(['src/player/rig.ts'], BEFORE_2B);
  const OldRig = old ? await loadRig(old) : null;
  ANIM_TUNE.swingPelvis = 'before';
  const all: number[] = [];
  for (const fps of [30, 60, 144]) {
    for (const s of swingsHere) {
      for (const legs of [null, ...legsHere.map(([st]) => st)]) {
        const now = swingRun(CharacterRig, s, legs, fps).trace;
        all.push(...now);
        if (OldRig) {
          const then = swingRun(OldRig, s, legs, fps).trace;
          ok(now.length === then.length && now.every((x, i) => Object.is(x, then[i])), `day one, ${s} ${legs ? `over ${legs}` : 'standing'} at ${fps}: 'before' is ${BEFORE_2B}'s rig, every bone's turn every frame`);
        }
      }
    }
  }
  const digest = createHash('sha1').update(all.join(',')).digest('hex').slice(0, 16);
  if (OldRig) note(`the 'before' trace's digest is ${digest} (BEFORE_TRACE, which a checkout with no history is held to; ${onDisk ? 'the human male rig' : 'the test\'s own skeleton'})`);
  else note(`git cannot hand over ${BEFORE_2B}'s rig here: the 'before' trace is held to the digest recorded from it`);
  if (onDisk) ok(digest === BEFORE_TRACE, `and its digest is the one recorded from ${BEFORE_2B}'s own rig on the human male (${digest})`);
  else ok(!!OldRig, 'without the rig on disk, git answers the day-one comparison');
}

// ---- a mutation of the mend fails its check -----------------------------------------------------------------------------------
{
  const src = readFileSync(join(REPO, 'src/player/rig.ts'), 'utf8').replace(/\r\n/g, '\n');
  const from = 'out.copy(parent.quaternion).invert().multiply(swingQ);';
  assert.ok(src.includes(from), 'the mutation finds the mend');
  const Mutant = await loadRig(new Map([['src/player/rig.ts', src.replace(from, 'out.copy(parent.quaternion).invert().multiply(parent.quaternion);')]]));
  ANIM_TUNE.swingPelvis = 'mended';
  let worst = 0;
  for (const s of swingsHere) {
    const stand = swingRun(Mutant, s, null, 60).rows;
    for (const [state] of legsHere) worst = Math.max(worst, worstApart(stand, swingRun(Mutant, s, state, 60).rows));
  }
  ok(worst > 5, `mutation: the turn onto the swing's own pelvis made nothing: the swing over the legs parts from standing again (worst ${worst.toFixed(1)} degrees)`);
  const weightLine = 'if (total < 1) out.slerpQuaternions(IDENTITY_Q, steadyFullQ.copy(out), total);';
  assert.ok(src.includes(weightLine), 'the mutation finds the weight');
  const weight = src.replace(weightLine, '');
  const NoFade = await loadRig(new Map([['src/player/rig.ts', weight]]));
  // The swing's weight: through its fade the turn goes on by it, so the first frame of a swing split onto the moving
  // legs turns the chest by the weight's share, not all at once.
  const firstFrames = (Cls: typeof CharacterRig) => {
    const { rig, group, at } = makeRig(Cls, bones, clips);
    rig.setState(legsHere[0][0] as never, 3);
    for (let i = 0; i < 18; i++) {
      rig.update(1 / 60);
      group.updateMatrixWorld(true);
      rig.twistTorso(0, 0);
    }
    const before = measure(at, group).chest;
    rig.play(swingsHere[0], { fadeIn: 0.1 });
    rig.overrideUpperOnly();
    rig.update(1 / 60);
    group.updateMatrixWorld(true);
    rig.twistTorso(0, 0);
    return Math.abs(measure(at, group).chest - before);
  };
  const eased = firstFrames(CharacterRig);
  const sudden = firstFrames(NoFade);
  ok(sudden > eased + 0.5, `and the turn comes in by the swing's own weight: on the first frame of a swing split onto the back-pedal the chest moves ${eased.toFixed(2)} degrees, where all at once it moves ${sudden.toFixed(2)}`);
  const endLine = '      this.swingFading = this.override;\n      this.override = null;';
  assert.ok(src.includes(endLine), 'the mutation finds the swing let go at its end');
  const EndMutant = await loadRig(new Map([['src/player/rig.ts', src.replace(endLine, '      this.override = null;')]]));
  ANIM_TUNE.swingPelvis = 'mended';
  const jumpMutant = endStep(EndMutant, 60);
  const jumpRule = endStep(CharacterRig, 60);
  ok(jumpMutant > jumpRule + 3, `mutation: a swing let go at its end without its fading weight: the chest drops onto the legs' hips in one frame (${jumpMutant.toFixed(1)} degrees a frame against the rule's ${jumpRule.toFixed(1)})`);
}

ANIM_TUNE.swingPelvis = 'mended';
console.log(`swingLean: ${checks} checks passed`);
