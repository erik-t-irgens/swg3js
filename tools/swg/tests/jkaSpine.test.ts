// Jedi Academy's clips' lower back (the owner's word of 2026-11-15: "it looks like I am bending my lower spine back so my
// lower back is concave"): measured on the converted rigs, read only, before anything was changed, and the mend held.
//
// The measure, on each converted species' own rig (its GLB read here, the clips as the converter wrote them): the hips'
// tilt (the pelvis joint's up axis against the figure's up, + forward), the lines from the pelvis to the first spine
// joint and up the spine (their lean, + forward), and each spine joint's bend against the bind pose (its turn against
// its parent's, about the figure's right axis, + forward), in the game's bind pose, the game's own idle, Jedi Academy's
// standing frame (`BOTH_STAND1`), its stances, swings, a block, its saber walk and run, and a swing's spine over the
// fitted Mixamo jog's pelvis (the upper body alone over the imported legs, as the rig plays it). Then the mend
// (`src/anim/jkaSpine.ts`, the very functions the rig calls) applied to the same keys and measured again. With no species
// on disk, a skeleton of the tests' own stands in for the mend's arithmetic. And what the mend leaves held to Jedi
// Academy's own install, where `JKA` names one (read only, the converter's own readers): the converted spine's turns from
// the standing frame against that game's own, bone for bone (`jkaOwn`).
//
// `rig.ts` reaches the parts character, which node's type stripping refuses, and names modules without their
// extensions: served a stub and the extensions by the resolve hook `locoRig.test.ts` uses.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

const { applyJkaSpine, isJkaClip, meanOf, qconj, qmul, rebaseClip, rebaseJkaClips, spineRebaseFor } = await import('../../../src/anim/jkaSpine.ts');
const { ANIM_TUNE, tuneAnim } = await import('../../../src/anim/animTune.ts');
const { CharacterRig, IMPORTED_CLIPS, attachImportedClips } = await import('../../../src/player/rig.ts');
const { MixamoPack } = await import('../../../src/anim/mixamoPack.ts');
const { repoRoot } = await import('./animFixtures.ts');
type Q = [number, number, number, number];
type V = [number, number, number];

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const root = repoRoot(import.meta.url);
const DEG = 180 / Math.PI;
const f1 = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

const qrot = (q: ArrayLike<number>, v: ArrayLike<number>): V => {
  const [x, y, z, w] = [q[0], q[1], q[2], q[3]];
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};
const qangle = (a: ArrayLike<number>, b: ArrayLike<number>) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * DEG;

/** A skeleton read off a GLB's nodes: each joint's name, its parent's index and its rest place and turn. */
interface Bone { name: string; parent: number; t: V; q: Q }
/** A clip's tracks by bone: rotations and translations, a key's values each, every key at one frame. */
interface Clip { name: string; rot: Map<string, Float32Array>; pos: Map<string, Float32Array>; keys: number }

/** A rig's GLB, read: its joints and the named clips (each track's keys, as the converter wrote them). */
function readRig(file: string, want: readonly string[]): { bones: Bone[]; clips: Map<string, Clip> } {
  const buf = readFileSync(file);
  const jlen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8')) as {
    nodes: { name?: string; extras?: { name?: string }; children?: number[]; translation?: number[]; rotation?: number[] }[];
    skins?: { joints: number[] }[];
    accessors: { bufferView: number; byteOffset?: number; count: number; type: string; componentType: number }[];
    bufferViews: { byteOffset?: number }[];
    animations?: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[];
  };
  const bin = buf.subarray(20 + jlen + 8);
  const nodes = gltf.nodes;
  const nameOf = (i: number) => nodes[i].extras?.name ?? nodes[i].name ?? `n${i}`;
  const parent = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));
  const joints = gltf.skins?.[0]?.joints ?? [];
  const index = new Map(joints.map((j, k) => [j, k]));
  const bones: Bone[] = joints.map((j) => ({ name: nameOf(j), parent: index.get(parent[j]) ?? -1, t: (nodes[j].translation ?? [0, 0, 0]) as V, q: (nodes[j].rotation ?? [0, 0, 0, 1]) as Q }));
  const acc = (i: number): Float32Array => {
    const a = gltf.accessors[i];
    const comps = a.type === 'SCALAR' ? 1 : a.type === 'VEC3' ? 3 : 4;
    const off = (gltf.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out = new Float32Array(a.count * comps);
    for (let k = 0; k < out.length; k++) out[k] = bin.readFloatLE(off + k * 4);
    return out;
  };
  const clips = new Map<string, Clip>();
  for (const a of gltf.animations ?? []) {
    if (!want.includes(a.name)) continue;
    const c: Clip = { name: a.name, rot: new Map(), pos: new Map(), keys: 0 };
    for (const ch of a.channels) {
      const s = a.samplers[ch.sampler];
      const name = nameOf(ch.target.node);
      if (ch.target.path === 'rotation') {
        const v = acc(s.output);
        c.rot.set(name, v);
        c.keys = Math.max(c.keys, v.length / 4);
      } else if (ch.target.path === 'translation') c.pos.set(name, acc(s.output));
    }
    clips.set(a.name, c);
  }
  return { bones, clips };
}

/** Each joint's world turn and place at a key of a clip (the bind where the clip has no track), the figure facing +Z. */
function pose(bones: Bone[], clip: Clip | null, key: number, over?: Map<string, Q>): { q: Q[]; p: V[] } {
  const q: Q[] = [], p: V[] = [];
  bones.forEach((b, i) => {
    let lq: Q = b.q, lt: V = b.t;
    const r = clip?.rot.get(b.name);
    if (r) {
      const k = Math.min(key, r.length / 4 - 1);
      lq = [r[k * 4], r[k * 4 + 1], r[k * 4 + 2], r[k * 4 + 3]];
    }
    const o = over?.get(b.name);
    if (o) lq = o;
    const t = clip?.pos.get(b.name);
    if (t) {
      const k = Math.min(key, t.length / 3 - 1);
      lt = [t[k * 3], t[k * 3 + 1], t[k * 3 + 2]];
    }
    if (b.parent >= 0) {
      const pq = q[b.parent], pp = p[b.parent];
      const r2 = qrot(pq, lt);
      q.push(qmul(pq, lq));
      p.push([pp[0] + r2[0], pp[1] + r2[1], pp[2] + r2[2]]);
    } else {
      q.push(lq);
      p.push(lt);
    }
  });
  return { q, p };
}

/** What the lower back is in a pose: the hips' tilt, the lines' leans and each spine joint's bend against the bind. */
interface Back { hips: number; rootToS1: number; s1to2: number; s2to3: number; bend: [number, number, number] }
function backOf(bones: Bone[], P: { q: Q[]; p: V[] }, bind: { q: Q[]; p: V[] }): Back {
  const at = (n: string) => bones.findIndex((b) => b.name === n);
  const [r, s1, s2, s3, nk] = ['root', 'spine1', 'spine2', 'spine3', 'neck'].map(at);
  const lean = (a: V, b: V) => Math.atan2(b[2] - a[2], b[1] - a[1]) * DEG;
  const up = qrot(P.q[r], [0, 1, 0]);
  const bend = (c: number, par: number): number => {
    // This joint's turn against its parent, against the same in the bind, about the figure's right axis.
    const rel = qmul(qconj(P.q[par]), P.q[c]);
    const relB = qmul(qconj(bind.q[par]), bind.q[c]);
    const d = qmul(rel, qconj(relB));
    const ax = qrot(P.q[par], [d[0], d[1], d[2]]);
    const len = Math.hypot(ax[0], ax[1], ax[2]);
    const ang = 2 * Math.atan2(Math.hypot(d[0], d[1], d[2]), d[3]) * DEG;
    return len > 1e-9 ? (ang * ax[0]) / len : 0;
  };
  void nk;
  return { hips: Math.atan2(up[2], up[1]) * DEG, rootToS1: lean(P.p[r], P.p[s1]), s1to2: lean(P.p[s1], P.p[s2]), s2to3: lean(P.p[s2], P.p[s3]), bend: [bend(s1, r), bend(s2, s1), bend(s3, s2)] };
}
const said = (b: Back) => `hips ${f1(b.hips)}, pelvis-to-spine ${f1(b.rootToS1)}, lower spine ${f1(b.s1to2)}, chest ${f1(b.s2to3)}; bends against the bind ${f1(b.bend[0])} ${f1(b.bend[1])} ${f1(b.bend[2])}`;

/** The clips measured: the standing frame, two stances, two swings, a block, the saber walk and run. */
const STANCES = ['BOTH_SABERSLOW_STANCE', 'BOTH_STAND2'];
const SWINGS = ['BOTH_A1_T__B_', 'BOTH_A2_TL_BR'];
const BLOCKS = ['BOTH_P1_S1_T_'];
const MOVES = ['BOTH_WALK2', 'BOTH_RUN2'];
const WANT = ['idle', 'BOTH_STAND1', ...STANCES, ...SWINGS, ...BLOCKS, ...MOVES];

/** The species measured, where on disk. */
const SPECIES = ['human_male', 'human_female', 'wookiee_male', 'bothan_female'];
const charDir = join(root, 'assets-private', 'characters');
const onDisk = SPECIES.filter((id) => existsSync(join(charDir, id, 'rig.glb')));

/** The fitted Mixamo jog's pelvis on a skeleton, its mean turn: what a swing's spine stands on over the imported legs. */
async function mixamoPelvis(bones: Bone[], label: string): Promise<Q | null> {
  const packDir = join(root, 'public', 'anims', 'mixamo');
  if (!existsSync(join(packDir, 'index.json'))) return null;
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
  const played = new Map<string, THREE.AnimationClip>();
  IMPORTED_CLIPS.provider = async (skeleton, l) => {
    const clips = await pack.clipsFor(skeleton, l);
    for (const c of clips) played.set(c.name, c);
    return clips;
  };
  IMPORTED_CLIPS.strides = (clip) => pack.strideOf(clip);
  const group = new THREE.Group();
  const made: THREE.Bone[] = [];
  bones.forEach((b) => {
    const t = new THREE.Bone();
    t.name = b.name;
    t.position.fromArray(b.t);
    t.quaternion.fromArray(b.q);
    made.push(t);
    (b.parent < 0 ? group : made[b.parent]).add(t);
  });
  const idle = new THREE.AnimationClip('idle', 1, [new THREE.QuaternionKeyframeTrack(`${bones[0].name}.quaternion`, [0, 1], [...bones[0].q, ...bones[0].q])]);
  const rig = CharacterRig.fromCharacter({ group, clips: [idle] } as never);
  const info = console.info;
  console.info = () => {};
  await attachImportedClips(rig, label);
  console.info = info;
  const jog = played.get('mx_slow_run');
  const track = jog?.tracks.find((t) => t.name === 'root.quaternion');
  if (!track) return null;
  const v = track.values;
  const s: Q = [0, 0, 0, 0];
  for (let i = 0; i < v.length; i += 4) for (let c = 0; c < 4; c++) s[c] += v[i + c];
  const l = Math.hypot(...s);
  return [s[0] / l, s[1] / l, s[2] / l, s[3] / l];
}

/** A clip of the GLB as the shape the mend takes (a three.js clip's), its rotations a fresh copy. */
const asSpineClip = (c: Clip) => ({ name: c.name, tracks: [...c.rot].map(([n, v]) => ({ name: `${n}.quaternion`, values: v.slice() })) });
/** The same back as a clip of ours, from the mend's tracks. */
const fromSpineClip = (s: { name: string; tracks: { name: string; values: Float32Array }[] }, c: Clip): Clip => ({ name: c.name, rot: new Map(s.tracks.map((t) => [t.name.replace(/\.quaternion$/, ''), t.values])), pos: c.pos, keys: c.keys });

/** Jedi Academy's install as the environment or `.env` names it (`JKA`), read only; null without one. */
const jkaDir = ((): string | null => {
  if (process.env.JKA) return process.env.JKA;
  const file = join(root, '.env');
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?JKA\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) return m[1].replace(/^(['"])(.*)\1$/, '$2');
  }
  return null;
})();

/**
 * What the mend leaves is Jedi Academy's own (the review's question: after the mend the saber walk and run and the
 * swings stay hollower than the idle and the stances flatter -- the game's own animation, or the converter?). Read
 * straight out of that game's install (the converter's own readers, the very `.gla` and `animation.cfg` it read, nothing
 * written), each spine bone's turn in the world from its standing frame, against the converted clip's same bone's from
 * its `BOTH_STAND1`, key for frame; and the lower back in the review's own measure (the pelvis line's lean less the
 * mid-back line's, + hollower) moved from the standing frame in that game's skeleton and in the mended clip.
 */
async function jkaOwn(id: string, bones: Bone[], clips: Map<string, Clip>, mended: Map<string, Clip>, names: readonly string[]): Promise<void> {
  if (!jkaDir || !existsSync(jkaDir)) {
    note(`${id}: no Jedi Academy install here (JKA in .env or the environment): what the mend leaves is not held to that game's own data`);
    return;
  }
  const { openJkaBase, parseGla, parseAnimationCfg, jkaWorld } = await import('../jka.mjs');
  const base = openJkaBase(jkaDir);
  try {
    const glaPath = 'models/players/_humanoid/_humanoid.gla';
    const cfgPath = 'models/players/_humanoid/animation.cfg';
    const src = base.archiveOf(glaPath);
    const gla = parseGla(src.read(glaPath));
    const cfg = parseAnimationCfg((src.has(cfgPath) ? src.read(cfgPath) : base.read(cfgPath)).toString('latin1'));
    const stand = cfg.get('BOTH_STAND1');
    const swgStand = clips.get('BOTH_STAND1');
    const mStand = mended.get('BOTH_STAND1');
    if (!stand || !swgStand || !mStand) {
      note(`${id}: the install or the rig has no BOTH_STAND1: what the mend leaves is not measured`);
      return;
    }
    // The converter's own pairs (`BONE_MAP`): Jedi Academy's pelvis and lumbar bones and the joints they drive.
    const pairs: [string, string][] = [['pelvis', 'root'], ['lower_lumbar', 'spine1'], ['upper_lumbar', 'spine2'], ['thoracic', 'spine3']];
    const jIdx = new Map(gla.bones.map((b: { name: string }, i: number) => [b.name.toLowerCase(), i]));
    const J = pairs.map(([j]) => jIdx.get(j) as number);
    const S = pairs.map(([, s]) => bones.findIndex((b) => b.name === s));
    if (J.some((i) => i === undefined) || S.some((i) => i < 0)) {
      note(`${id}: the skeletons lack a bone of the pairs: what the mend leaves is not measured`);
      return;
    }
    // jkaWorld answers glTF space with w first; the tests' quaternions are x, y, z, w.
    const xyzw = (q: number[]): Q => [q[1], q[2], q[3], q[0]];
    const lean = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.atan2(b[2] - a[2], b[1] - a[1]) * DEG;
    const hollowJ = (w: { t: number[] }[]) => lean(w[J[0]].t, w[J[1]].t) - lean(w[J[2]].t, w[J[3]].t);
    const hollowS = (p: V[]) => lean(p[S[0]], p[S[1]]) - lean(p[S[2]], p[S[3]]);
    const ref = jkaWorld(gla, stand.first) as { q: number[]; t: number[] }[];
    const s0 = pose(bones, swgStand, 0);
    const frameOf = (e: { first: number; count: number; reverse: boolean }, k: number) => (e.reverse ? e.first + e.count - 1 - k : e.first + k);
    const mean = (e: { first: number; count: number; reverse: boolean }, clip: Clip) => {
      let hj = 0, hs = 0;
      for (let k = 0; k < e.count; k++) {
        hj += hollowJ(jkaWorld(gla, frameOf(e, k)));
        hs += hollowS(pose(bones, clip, k).p);
      }
      return { j: hj / e.count, s: hs / e.count };
    };
    const standMean = mean(stand, mStand);
    let worst = 0, worstAt = '';
    const rows: string[] = [];
    const moves: { name: string; j: number; s: number }[] = [];
    for (const name of names) {
      const e = cfg.get(name);
      const c = clips.get(name);
      const m = mended.get(name);
      if (!e || !c || !m) continue;
      if (c.keys < e.count) {
        note(`${id}: ${name} has ${c.keys} keys where that game has ${e.count} frames: not compared key for frame`);
        continue;
      }
      // Each paired bone's turn in the world from the standing frame, the converted clip's (as converted) against the game's.
      for (let k = 0; k < e.count; k++) {
        const w = jkaWorld(gla, frameOf(e, k)) as { q: number[] }[];
        const s = pose(bones, c, k);
        for (let i = 0; i < pairs.length; i++) {
          const dJ = xyzw(qmulW(w[J[i]].q, conjW(ref[J[i]].q)));
          const dS = qmul(s.q[S[i]], qconj(s0.q[S[i]]));
          const a = qangle(dS, dJ);
          if (a > worst) [worst, worstAt] = [a, `${name} frame ${k}, ${pairs[i][0]}`];
        }
      }
      const h = mean(e, m);
      const dj = h.j - standMean.j, ds = h.s - standMean.s;
      moves.push({ name, j: dj, s: ds });
      rows.push(`${name} ${f1(dj)} in Jedi Academy, ${f1(ds)} mended`);
    }
    ok(moves.length >= 5 && worst < 0.5, `${id}: every paired spine bone of every clip compared (${moves.length}) turns in the world from its standing frame exactly as the same bone of Jedi Academy's own data does, key for frame, to within ${worst.toFixed(3)} degrees at the worst (${worstAt}; the bound half a degree): the converter carries that game's spine faithfully, so what the mend leaves is that game's own motion, not a fault of the retarget`);
    // The plane measure is not the bones' turns: it folds a twisted pelvis's turn into the lean, and the two skeletons'
    // bones lie differently, so it agrees closely only where the move stays square (the walk, the run, the overhead
    // swing) and keeps its sign everywhere.
    const square = moves.filter((x) => MOVES.includes(x.name) || x.name === 'BOTH_A1_T__B_');
    ok(square.length >= 2 && square.every((x) => Math.abs(x.j - x.s) < 1.5) && moves.every((x) => Math.abs(x.j) < 3 || Math.sign(x.j) === Math.sign(x.s)), `${id}: the lower back moves from the standing frame (+ hollower) as Jedi Academy's own does: within a degree and a half on the square moves (${square.map((x) => `${x.name} ${f1(x.j)} against ${f1(x.s)}`).join(', ')}) and the same way on every clip`);
    note(`${id}: the lower back's change from the standing frame in that game's own skeleton and in the mended clip, in the review's measure (+ hollower): ${rows.join(' | ')}`);
  } finally {
    base.close();
  }
}
/** Quaternions w first (Jedi Academy's reader's own order). */
const qmulW = (a: number[], b: number[]): number[] => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const conjW = (q: number[]): number[] => [q[0], -q[1], -q[2], -q[3]];

if (!onDisk.length) {
  note('no converted species on disk (assets-private/characters): the mend\'s arithmetic is held on a skeleton of the tests\' own, and nothing is measured');
} else {
  for (const id of onDisk) {
    const { bones, clips } = readRig(join(charDir, id, 'rig.glb'), WANT);
    const idleClip = clips.get('idle');
    if (!idleClip || !['root', 'spine1', 'spine2', 'spine3', 'neck'].every((n) => bones.some((b) => b.name === n))) {
      note(`${id}: no idle or no spine of the expected names on its rig: not measured`);
      continue;
    }
    const bind = pose(bones, null, 0);
    const back = (c: Clip | null, key: number, over?: Map<string, Q>) => backOf(bones, pose(bones, c, key, over), bind);
    const idleKeys = idleClip.keys;
    // The idle's mean (its breath averaged), as the mend reads it.
    const idleMean = new Map<string, Q>();
    for (const n of ['spine1', 'spine2', 'spine3']) idleMean.set(n, meanOf(asSpineClip(idleClip), n)!);
    const idleB = back(idleClip, 0, idleMean);
    const bindB = backOf(bones, bind, bind);
    const stand = clips.get('BOTH_STAND1')!;
    const standB = back(stand, 0);
    // ---- the cause --------------------------------------------------------------------------------------------------------
    note(`${id}: the bind pose: ${said(bindB)}`);
    note(`${id}: the game's own idle (its mean over ${idleKeys} keys): ${said(idleB)}`);
    note(`${id}: Jedi Academy's standing frame BOTH_STAND1: ${said(standB)}`);
    ok(Math.abs(standB.bend[0]) < 0.05 && Math.abs(standB.bend[1]) < 0.05 && Math.abs(standB.bend[2]) < 0.05 && Math.abs(standB.hips - bindB.hips) < 0.05, `${id}: Jedi Academy's standing frame is the bind pose to a twentieth of a degree: the converter lays that game's standing frame on the skeleton's bind pose`);
    ok(Math.abs(standB.rootToS1 - bindB.rootToS1) < 0.05 && Math.abs(idleB.rootToS1 - bindB.rootToS1) < 3, `${id}: the pelvis-to-spine line leans ${bindB.rootToS1.toFixed(1)} degrees forward in the bind, the idle (${idleB.rootToS1.toFixed(1)}) and Jedi Academy's standing frame alike: the skeleton's own build, which the Jedi Academy retarget never lines up by direction (its spine is left unaligned), so the lead's guess of a 32-degree tip from lining bones up is not the cause`);
    const lumbar = idleB.bend[0] + idleB.bend[1];
    ok(lumbar > 3, `${id}: the cause: against the game's own idle the bind pose's lower back is bent back by ${lumbar.toFixed(1)} degrees (the first spine joint ${idleB.bend[0].toFixed(1)}, the second ${idleB.bend[1].toFixed(1)}; the chest's joint ${idleB.bend[2].toFixed(1)} the other way), and every Jedi Academy clip starts from it`);
    // Each clip measured, before the mend: the hips and the lower back against the idle's.
    const rows: string[] = [];
    const before = new Map<string, Back>();
    for (const name of [...STANCES, ...SWINGS, ...BLOCKS, ...MOVES]) {
      const c = clips.get(name);
      if (!c) continue;
      const mid = Math.floor(c.keys / 2);
      const b = back(c, mid);
      before.set(name, b);
      rows.push(`${name} (key ${mid}): ${said(b)}; lower back against the idle ${f1(b.bend[0] + b.bend[1] - lumbar)}, hips ${f1(b.hips - idleB.hips)}`);
    }
    note(`${id}: before the mend, ${rows.join(' | ')}`);
    // The split: a swing's spine over the fitted Mixamo jog's pelvis (the upper body alone over the imported legs).
    if (id === onDisk[0]) {
      const pelvis = await mixamoPelvis(bones, id);
      if (pelvis) {
        const over = new Map<string, Q>([['root', pelvis]]);
        const jogHips = Math.atan2(qrot(pelvis, [0, 1, 0])[2], qrot(pelvis, [0, 1, 0])[1]) * DEG;
        const s1 = bones.findIndex((b) => b.name === 'spine1'), s3 = bones.findIndex((b) => b.name === 'spine3');
        const split: string[] = [];
        let worstTurn = 0, worstClip = '';
        let sameLocal = true;
        for (const name of [...SWINGS, ...BLOCKS, ...STANCES]) {
          const c = clips.get(name);
          if (!c) continue;
          for (const k of [0, Math.floor(c.keys / 2), c.keys - 1]) {
            const w = pose(bones, c, k), u = pose(bones, c, k, over);
            // The spine's own turns are the clip's either way (its keys are local to the pelvis)...
            // (A tenth of a degree: the keys' turns are float32 and not quite of length one.)
            if (qangle(qmul(qconj(w.q[0]), w.q[s1]), qmul(qconj(u.q[0]), u.q[s1])) > 0.1) sameLocal = false;
            // ...so the chest goes wherever the pelvis under it takes it.
            const turn = qangle(w.q[s3], u.q[s3]);
            if (turn > worstTurn) [worstTurn, worstClip] = [turn, `${name} key ${k}`];
          }
          const mid = Math.floor(c.keys / 2);
          split.push(`${name}: chest line ${f1(back(c, mid).s2to3)} whole, ${f1(back(c, mid, over).s2to3)} over the jog`);
        }
        ok(sameLocal && worstTurn > 1, `${id}: over the Mixamo jog's pelvis (its mean tips ${jogHips.toFixed(1)} degrees forward, and stands square) a swing's, a block's and a stance's spine keep their own turns against the pelvis, so the chest goes wherever the jog's pelvis takes it: up to ${worstTurn.toFixed(1)} degrees from where the whole-body clip has it (${worstClip}), Jedi Academy's own pelvis there being tipped and twisted by the move (${split.join('; ')})`);
      } else note(`${id}: the Mixamo pack is not on disk: the split is not measured`);
    }
    // ---- the mend --------------------------------------------------------------------------------------------------------
    const skel = bones.map((b) => ({ name: b.name, parent: b.parent >= 0 ? bones[b.parent].name : '', rest: b.q }));
    const r = spineRebaseFor(skel, asSpineClip(idleClip));
    ok(r !== null && r.chain.map((c) => c.name).join() === 'spine1,spine2,spine3' && r.kids.length >= 3, `${id}: the mend is worked out from the skeleton and its idle: a turn for each of ${r?.chain.map((c) => c.name).join(', ')}, and ${r?.kids.join(', ')} hung from the top of the spine kept where the clip has them`);
    const mended = new Map<string, Clip>();
    for (const name of ['BOTH_STAND1', ...STANCES, ...SWINGS, ...BLOCKS, ...MOVES]) {
      const c = clips.get(name);
      if (!c) continue;
      const sc = asSpineClip(c);
      const turned = rebaseClip(sc, r!);
      assert.ok(turned, `${id}: ${name} carries every track the mend needs`);
      for (const t of turned!) t.track.values = t.after;
      mended.set(name, fromSpineClip(sc, c));
    }
    const standM = back(mended.get('BOTH_STAND1')!, 0);
    const standMQ = mended.get('BOTH_STAND1')!;
    const within = Math.max(...['spine1', 'spine2', 'spine3'].map((n) => {
      const v = standMQ.rot.get(n)!;
      return qangle(v.subarray(0, 4), idleMean.get(n)!);
    }));
    ok(within < 0.05 && Math.abs(standM.hips - bindB.hips) < 0.05 && Math.abs(standM.s1to2 - idleB.s1to2) < Math.abs(idleB.hips) + 0.5 && Math.abs(standM.s2to3 - idleB.s2to3) < Math.abs(idleB.hips) + 0.5, `${id}: mended, Jedi Academy's standing frame's spine stands as the game's own idle's: each spine joint's turn against its parent within 0.05 degrees of the idle's mean (the tolerance; ${within.toFixed(4)} at the worst), the hips left as the clip has them (the bind's, ${Math.abs(idleB.hips).toFixed(1)} degrees from the idle's), so the lower spine's and the chest's lines stand within that of the idle's (${f1(standM.s1to2)} against ${f1(idleB.s1to2)}, ${f1(standM.s2to3)} against ${f1(idleB.s2to3)})`);
    // The neck and the shoulders: where each clip has them in the world (against the hips), to a hundredth of a degree.
    let kept = 0;
    let moved = 0;
    for (const [name, m] of mended) {
      const c = clips.get(name)!;
      for (let k = 0; k < c.keys; k += Math.max(1, Math.floor(c.keys / 8))) {
        const a = pose(bones, c, k), b = pose(bones, m, k);
        for (const n of r!.kids) {
          const i = bones.findIndex((x) => x.name === n);
          kept = Math.max(kept, qangle(a.q[i], b.q[i]));
        }
        const s1 = bones.findIndex((x) => x.name === 'spine1');
        moved = Math.max(moved, qangle(a.q[s1], b.q[s1]));
      }
    }
    ok(kept < 0.1 && moved > 1, `${id}: and in every clip mended the neck and both shoulders keep their turn in the world to within ${kept.toFixed(4)} degrees (a tenth of a degree, the keys being float32), while the spine moves by up to ${moved.toFixed(1)}: the arms and the head hold the saber and the look where the clip has them`);
    const after: string[] = [];
    for (const name of [...STANCES, ...SWINGS, ...BLOCKS, ...MOVES]) {
      const m = mended.get(name);
      const b0 = before.get(name);
      if (!m || !b0) continue;
      const mid = Math.floor(m.keys / 2);
      const b = back(m, mid);
      const shift = b.bend[0] + b.bend[1] - (b0.bend[0] + b0.bend[1]);
      // (Measured about the figure's right axis, which a pelvis the move has twisted turns the joints' own bends from: two degrees.)
      assert.ok(Math.abs(shift - lumbar) < 2, `${id}: ${name}'s lower back moves by the bind-to-idle bend (${shift.toFixed(2)} against ${lumbar.toFixed(2)})`);
      after.push(`${name}: lower back against the idle ${f1(b0.bend[0] + b0.bend[1] - lumbar)} before, ${f1(b.bend[0] + b.bend[1] - lumbar)} after; hips ${f1(b.hips - idleB.hips)} (the clip's own); chest ${f1(b0.s2to3)} before, ${f1(b.s2to3)} after`);
    }
    checks++;
    ok(true, `${id}: every stance, swing, block, walk and run measured has its lower back moved forward by the bind-to-idle bend (${lumbar.toFixed(1)} degrees, within two)`);
    note(`${id}: after the mend (- is hollower than the idle, + more bent forward): ${after.join(' | ')}`);
    if (id === onDisk[0]) await jkaOwn(id, bones, clips, mended, [...STANCES, ...SWINGS, ...BLOCKS, ...MOVES]);
  }
}

// ---- the mend's arithmetic, on a skeleton of the tests' own (whatever is on disk) ----------------------------------------
{
  const ax = (x: number, deg: number): Q => [Math.sin((deg / DEG) / 2) * x, 0, 0, Math.cos((deg / DEG) / 2)];
  const bones = [
    { name: 'root', parent: '', rest: [0, 0, 0, 1] as Q },
    { name: 'spine1', parent: 'root', rest: ax(1, 5) },
    { name: 'spine2', parent: 'spine1', rest: ax(1, -3) },
    { name: 'spine3', parent: 'spine2', rest: ax(1, 2) },
    { name: 'neck', parent: 'spine3', rest: ax(1, 1) },
    { name: 'lClav', parent: 'spine3', rest: [0, 0, 0.3826834, 0.9238795] as Q },
    { name: 'rClav', parent: 'spine3', rest: [0, 0, -0.3826834, 0.9238795] as Q },
    { name: 'lThigh', parent: 'root', rest: [0, 0, 1, 0] as Q },
  ];
  const track = (name: string, ...qs: Q[]) => ({ name: `${name}.quaternion`, values: new Float32Array(qs.flat()) });
  // An idle that bends the lower spine forward 10 and the chest's joint back 12, breathing a degree.
  const idle = { name: 'idle', tracks: [track('spine1', ax(1, 15), ax(1, 16)), track('spine2', ax(1, -3), ax(1, -3)), track('spine3', ax(1, -10), ax(1, -11))] };
  const r = spineRebaseFor(bones, idle)!;
  // A Jedi Academy standing frame at the bind, and a swing.
  const standing = { name: 'BOTH_STAND1', tracks: bones.filter((b) => b.name !== 'root' && b.name !== 'lThigh').map((b) => track(b.name, b.rest, b.rest)) };
  const turned = rebaseClip(standing, r)!;
  const after = new Map(turned.map((t) => [t.track.name, t.after]));
  const mean1 = meanOf(idle, 'spine1')!, mean3 = meanOf(idle, 'spine3')!;
  const s1 = after.get('spine1.quaternion')!, s3 = after.get('spine3.quaternion')!;
  ok(qangle(s1.subarray(0, 4), mean1) < 0.05 && qangle(s3.subarray(0, 4), mean3) < 0.05, 'a standing frame at the bind, mended, stands at the idle\'s mean at every spine joint (within 0.05 degrees, the keys being float32)');
  // The children of the top spine joint keep their turn against the pelvis: G(spine3) local(neck) unchanged.
  const chain = (m: Map<string, Float32Array> | null) => {
    const q = (n: string): Q => (m?.get(`${n}.quaternion`)?.subarray(0, 4) as unknown as Q) ?? bones.find((b) => b.name === n)!.rest;
    return qmul(qmul(qmul(q('spine1'), q('spine2')), q('spine3')), q('neck'));
  };
  ok(qangle(chain(after), chain(null)) < 0.05, 'and the neck hung from it keeps its turn against the pelvis');
  // A mutation of the mend: the chest's joint left out of the turn moves the neck.
  const bad = { chain: r.chain.map((c, i) => (i === 2 ? { ...c, k: [0, 0, 0, 1] as Q } : c)), kids: r.kids };
  const wrong = new Map(rebaseClip(standing, bad)!.map((t) => [t.track.name, t.after]));
  ok(qangle(chain(wrong), chain(null)) > 1 || qangle(wrong.get('spine3.quaternion')!.subarray(0, 4), mean3) > 1, 'a mend with one joint\'s turn left out fails both: the check can fail');
  ok(isJkaClip('BOTH_A1_T__B_') && isJkaClip('TORSO_X') && isJkaClip('LEGS_Y') && !isJkaClip('idle') && !isJkaClip('mx_slow_run') && !isJkaClip('loop_rifle:speed2'), 'Jedi Academy\'s clips are told by that game\'s own names, and nothing else is turned');
  ok(rebaseClip({ name: 'BOTH_X', tracks: [track('spine1', ax(1, 0))] }, r) === null, 'a clip lacking a track the mend needs is left as it is');
  // Once a clip, the switch writing in place, 'before' the keys as converted to the bit.
  const clip = { name: 'BOTH_SWING', tracks: standing.tracks.map((t) => ({ name: t.name, values: t.values.slice() })) };
  const orig = clip.tracks.map((t) => Array.from(t.values));
  const firstArrays = clip.tracks.map((t) => t.values);
  ok(rebaseJkaClips([clip], r, true) === 1 && rebaseJkaClips([clip], r, true) === 0, 'a clip is rebased once however many rigs share it');
  ok(clip.tracks.every((t, i) => t.values !== firstArrays[i]), 'each turned track takes keys of its own before anything plays it (two tracks the loader handed one array are never turned twice)');
  ok(clip.tracks.some((t, i) => Array.from(t.values).some((v, k) => v !== orig[i][k])), 'mended, the keys are turned');
  applyJkaSpine(false);
  ok(clip.tracks.every((t, i) => Array.from(t.values).every((v, k) => Object.is(v, orig[i][k]))), 'the switch\'s \'before\': every key as converted, to the bit');
  applyJkaSpine(true);
  ok(clip.tracks.some((t, i) => Array.from(t.values).some((v, k) => v !== orig[i][k])), 'and \'mended\' again');
  // The tune's switch tells the rig's watcher (rig.ts registers it as it loads).
  const was = ANIM_TUNE.jkaSpine;
  ok(tuneAnim({ jkaSpine: 'before' }).length === 0 && clip.tracks.every((t, i) => Array.from(t.values).every((v, k) => Object.is(v, orig[i][k]))), 'the tune\'s `jkaSpine` set to \'before\' puts every clip rebased so far back as converted, through the watcher the rig registers');
  ok(tuneAnim({ jkaSpine: 'mended' }).length === 0 && ANIM_TUNE.jkaSpine === was && tuneAnim({ jkaSpine: 'sideways' }).length === 1, 'and \'mended\' takes them again; any other word is refused');
}

// ---- the wiring, as text --------------------------------------------------------------------------------------------------
{
  const rig = readFileSync(join(root, 'src', 'player', 'rig.ts'), 'utf8').replace(/\r\n/g, '\n');
  const at = rig.indexOf('rebaseJkaClips(clips as never, spineRebaseFor(skel, idleClip as never), ANIM_TUNE.jkaSpine === \'mended\');');
  ok(at > 0 && at < rig.indexOf('this.actions.set(clip.name, this.mixer.clipAction(clip));') && rig.includes('watchJkaSpine(() => applyJkaSpine(ANIM_TUNE.jkaSpine === \'mended\'));'), 'the rig rebases its clips as it is made, before any action plays them, and turns them back and forth as the switch moves: every body that plays the clips (the player, the peers, the fighters, the people lent them) plays the same keys');
}

console.log(`\n${checks} checks passed`);
