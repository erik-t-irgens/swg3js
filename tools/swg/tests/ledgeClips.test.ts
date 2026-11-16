// Wave 4 of the animations, the ledge clips' measured table (src/anim/ledgeClips.ts) measured again from the very clips the
// pack fits for the converted human male (`MixamoPack.clipsFor`), the way it was first made: each clip's length and loop,
// where a grab starts (the first frame from which its hands stay within 0.12 m of their end's height), the hands' grip
// point (between the wrist and the index knuckle, the two hands' middle) and their span at the start and the end, the
// ankles' middle height there, and the clip's own travel scaled to him. Every number within a millimetre (the table keeps
// three decimals), so a reimport that moves a clip fails here and not in a hang in the game. The twins set aside are their
// twins' poses; every role names a clip of the table; and the pack holds every clip the game asks it for.
//
// Without the converted human male (no packs here) only the names are checked: the numbers are his.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { MixamoPack } from '../../../src/anim/mixamoPack.ts';
import { LEDGE_FACTS, LEDGE_IDS, LEDGE_JUMP_OFF, LEDGE_REST, LEDGE_ROLES, LEDGE_STEP_DOWN, LEDGE_TWINS, ledgeClipName } from '../../../src/anim/ledgeClips.ts';
import { glbSkeleton, speciesBodies } from './animFixtures.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const packDir = join(REPO, 'public', 'anims', 'mixamo');
const index = JSON.parse(readFileSync(join(packDir, 'index.json'), 'utf8')) as { clips: { id: string; loop: boolean; travelNet: number[] }[] };
const rowOf = (id: string) => index.clips.find((c) => c.id === id) ?? null;

// ---- the names ------------------------------------------------------------------------------------------------------------
ok(LEDGE_IDS.every((id) => !!rowOf(id)), `the pack holds every clip the ledges ask for (${LEDGE_IDS.length})`);
const roleClips = [...Object.values(LEDGE_ROLES.braced), ...Object.values(LEDGE_ROLES.free)].filter((c): c is string => c !== null);
ok(roleClips.every((c) => c in LEDGE_FACTS) && LEDGE_JUMP_OFF in LEDGE_FACTS && LEDGE_STEP_DOWN in LEDGE_FACTS, 'every role names a clip of the table');
ok(Object.keys(LEDGE_TWINS).every((t) => !!rowOf(t) && !(t in LEDGE_FACTS) && !!rowOf(LEDGE_TWINS[t])), 'every twin set aside is in the pack, is none of the table\'s, and names a clip the pack holds');
ok(LEDGE_IDS.every((id) => rowOf(id)!.loop === LEDGE_FACTS[id].loop), 'each clip loops as the pack says it does');

const body = speciesBodies(REPO).find((b) => b.id === 'human_male');
if (!body) {
  note("no converted human male here: the table's numbers are his and are not measured again");
} else {
  const target = glbSkeleton(body.body);
  const twinIds = [...Object.keys(LEDGE_TWINS), ...Object.values(LEDGE_TWINS)];
  const pack = new MixamoPack({
    enabled: () => true,
    index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
    clip: async (file: string) => {
      const b = readFileSync(join(packDir, file));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    breath: async () => {},
    also: [...LEDGE_IDS, ...twinIds],
    now: () => performance.now(),
  });
  const info = console.info;
  console.info = () => {};
  const clips = await pack.clipsFor(target as never, 'ledges');
  console.info = info;
  const scale = (pack as unknown as { fits: Map<unknown, { plan: { scale: number } }> }).fits.values().next().value!.plan.scale;
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.fromArray(target.base.p);
  inner.quaternion.fromArray(target.base.q);
  root.add(inner);
  const bones = new Map<string, THREE.Bone>();
  const made: THREE.Bone[] = [];
  target.joints.forEach((j) => {
    const b = new THREE.Bone();
    b.name = j.name;
    b.position.fromArray(j.restP);
    b.quaternion.fromArray(j.restQ);
    made.push(b);
    bones.set(j.name, b);
    (j.parent < 0 ? inner : made[j.parent]).add(b);
  });
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const P = (n: string): number[] => {
    bones.get(n)!.getWorldPosition(v);
    return [v.x, v.y, v.z];
  };
  ok(Math.abs(P('root')[1] - LEDGE_REST.hips) < 1e-3 && Math.abs((P('lAnkle')[1] + P('rAnkle')[1]) / 2 - LEDGE_REST.ankle) < 1e-3, `the human male's rest pose: hips ${P('root')[1].toFixed(3)} m, ankles ${((P('lAnkle')[1] + P('rAnkle')[1]) / 2).toFixed(3)} m, as the table has them`);
  const mixer = new THREE.AnimationMixer(root);
  const grip = (s: string) => {
    const w = P(`${s}Wrist`);
    const i = P(`${s}Index01`);
    return [(w[0] + i[0]) / 2, (w[1] + i[1]) / 2, (w[2] + i[2]) / 2];
  };
  const GRAB = new Set(['jumping_to_hanging', 'braced_hang', 'idle_to_braced_hang', 'jump_to_hang', 'stand_to_freehang']);
  const sample = (id: string) => {
    const clip = clips.find((c) => c.name === ledgeClipName(id))!;
    mixer.stopAllAction();
    const a = mixer.clipAction(clip);
    a.reset().play();
    const T = clip.duration;
    const at = (t: number) => {
      a.time = Math.min(T - 1e-5, Math.max(0, t));
      mixer.update(0);
      root.updateMatrixWorld(true);
      const L = grip('l');
      const R = grip('r');
      return { L, R, m: [(L[0] + R[0]) / 2, (L[1] + R[1]) / 2, (L[2] + R[2]) / 2], ank: (P('lAnkle')[1] + P('rAnkle')[1]) / 2 };
    };
    return { T, at };
  };
  const near = (a: number, b: number) => Math.abs(a - b) <= 1.5e-3;
  const near3 = (a: number[], b: readonly number[]) => a.every((x, k) => near(x, b[k]));
  let worst = 0;
  let worstAt = '';
  for (const id of LEDGE_IDS) {
    const f = LEDGE_FACTS[id];
    const { T, at } = sample(id);
    const end = at(T);
    let t0 = 0;
    if (GRAB.has(id)) {
      const n = Math.round(T * 60);
      let first = T;
      for (let k = n; k >= 0; k--) {
        const t = (T * k) / n;
        if (Math.abs(at(t).m[1] - end.m[1]) < 0.12) first = t;
        else break;
      }
      t0 = first;
    }
    const s0 = at(t0);
    const net = rowOf(id)!.travelNet.map((x) => x * scale);
    const got = [T, t0, ...s0.m, ...end.m, s0.L[0] - s0.R[0], end.L[0] - end.R[0], s0.ank, end.ank, ...net];
    const want = [f.dur, f.t0, ...f.g0, ...f.g1, f.span0, f.span1, f.a0, f.a1, ...f.net];
    got.forEach((x, k) => {
      const d = Math.abs(x - want[k]);
      if (d > worst) {
        worst = d;
        worstAt = `${id}[${k}] ${x.toFixed(4)} against ${want[k]}`;
      }
    });
    assert.ok(near(T, f.dur) && near(t0, f.t0) && near3(s0.m, f.g0) && near3(end.m, f.g1) && near(s0.L[0] - s0.R[0], f.span0) && near(end.L[0] - end.R[0], f.span1) && near(s0.ank, f.a0) && near(end.ank, f.a1) && near3(net, f.net), `${id} measures as the table has it (${worstAt})`);
  }
  ok(worst <= 1.5e-3, `every clip of the table measures again within a millimetre and a half (the table rounds to one), on the human male's own fit (worst ${(worst * 1000).toFixed(2)} mm${worstAt ? `, ${worstAt}` : ''})`);
  // The twins: their poses are their twins' (the hands' middle and the ankles at the start, the middle and the end).
  let twinWorst = 0;
  for (const [t, of] of Object.entries(LEDGE_TWINS)) {
    // One clip sampled whole before the other: they share the one mixer.
    const a = sample(t);
    const pa = [0, 0.5, 1].map((u) => a.at(a.T * u));
    const b = sample(of);
    const pb = [0, 0.5, 1].map((u) => b.at(b.T * u));
    pa.forEach((x, k) => {
      const y = pb[k];
      twinWorst = Math.max(twinWorst, Math.hypot(x.m[0] - y.m[0], x.m[1] - y.m[1], x.m[2] - y.m[2]), Math.abs(x.ank - y.ank));
    });
  }
  ok(twinWorst < 0.02, `each twin set aside poses its twin's hands and feet (worst ${(twinWorst * 1000).toFixed(1)} mm at its start, middle and end)`);
}
console.log(`ledgeClips: ${checks} checks passed`);
