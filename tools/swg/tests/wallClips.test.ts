// Wave 4 of the animations, item B: the wall clips' measured table (src/anim/wallClips.ts) measured again from the very
// clips the pack fits for the converted human male (`MixamoPack.clipsFor`), the way it was first made: each clip's length,
// its planted hands' grip points and planted feet's balls forward of the figure (a limb planted within 4 cm of its own
// nearest approach to the wall), how fast a planted hand slides along the wall (the median over its planted frames), and
// the grip points', balls' and hips' mean heights. Every number within a millimetre and a half (the table keeps three
// decimals), so a reimport that moves a clip fails here and not on a wall in the game. And the pack fits both as loops
// with their net climb taken out: the down clip's hips (1.26 m a round in its file) end where they began.
//
// Without the converted human male (no packs here) only the names are checked: the numbers are his.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { MixamoPack } from '../../../src/anim/mixamoPack.ts';
import { PALM_OFF, WALL_FACTS, WALL_IDS, clipLift, clipWall, wallClipName } from '../../../src/anim/wallClips.ts';
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
ok(WALL_IDS.every((id) => !!rowOf(id) && id in WALL_FACTS), `the pack holds both wall clips the climb asks for (${WALL_IDS.join(', ')}), each in the table`);
ok(Math.abs(rowOf('climbing_down_wall')!.travelNet[1]) > 1, `the down clip falls ${rowOf('climbing_down_wall')!.travelNet[1]} m a round in its file (the pack takes it out)`);

const body = speciesBodies(REPO).find((b) => b.id === 'human_male');
if (!body) {
  note("no converted human male here: the table's numbers are his and are not measured again");
} else {
  const target = glbSkeleton(body.body);
  const pack = new MixamoPack({
    enabled: () => true,
    index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
    clip: async (file: string) => {
      const b = readFileSync(join(packDir, file));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    breath: async () => {},
    also: WALL_IDS,
    now: () => performance.now(),
  });
  const info = console.info;
  console.info = () => {};
  const clips = await pack.clipsFor(target as never, 'walls');
  console.info = info;
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
  const grip = (s: string) => {
    const w = P(`${s}Wrist`);
    const i = P(`${s}Index01`);
    return [(w[0] + i[0]) / 2, (w[1] + i[1]) / 2, (w[2] + i[2]) / 2];
  };
  const mixer = new THREE.AnimationMixer(root);
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const near = (a: number, b: number) => Math.abs(a - b) <= 1.5e-3;
  let worst = 0;
  for (const id of WALL_IDS) {
    const f = WALL_FACTS[id];
    const clip = clips.find((c) => c.name === wallClipName(id))!;
    ok(!!clip, `the pack fits ${id}`);
    mixer.stopAllAction();
    const a = mixer.clipAction(clip);
    a.reset().play();
    const T = clip.duration;
    const n = Math.round(T * 60);
    const rows: number[][] = [];
    for (let k = 0; k <= n; k++) {
      a.time = Math.min(T - 1e-5, (T * k) / n);
      mixer.update(0);
      root.updateMatrixWorld(true);
      rows.push([a.time, ...grip('l'), ...grip('r'), ...P('lToe'), ...P('rToe'), ...P('root')]);
    }
    const limb = (off: number) => {
      const zmax = Math.max(...rows.map((r) => r[off + 2]));
      return { zmax, z: med(rows.filter((r) => r[off + 2] >= zmax - 0.04).map((r) => r[off + 2])) };
    };
    const L = limb(1);
    const R = limb(4);
    const lT = limb(7);
    const rT = limb(10);
    const rates: number[] = [];
    for (const [off, lm] of [[1, L], [4, R]] as const) {
      for (let k = 1; k < rows.length; k++) {
        const p0 = rows[k - 1];
        const p1 = rows[k];
        if (p0[off + 2] >= lm.zmax - 0.04 && p1[off + 2] >= lm.zmax - 0.04) rates.push((p1[off + 1] - p0[off + 1]) / (p1[0] - p0[0]));
      }
    }
    const mean = (k: number) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
    const got = [T, (L.z + R.z) / 2, (lT.z + rT.z) / 2, Math.abs(med(rates)), (mean(2) + mean(5)) / 2, (mean(8) + mean(11)) / 2, mean(14)];
    const want = [f.dur, f.hand, f.foot, f.stride, f.hands, f.feet, f.hips];
    got.forEach((x, k) => (worst = Math.max(worst, Math.abs(x - want[k]))));
    ok(got.every((x, k) => near(x, want[k])), `${id} measures as the table has it (${got.map((x) => x.toFixed(3)).join(', ')})`);
    // Played round with its net climb taken out: the hips at the round's end where they began.
    const h0 = rows[0][14];
    const h1 = rows[rows.length - 1][14];
    ok(Math.abs(h1 - h0) < 0.01, `${id} is fitted as a loop with its climb taken out: its hips end ${((h1 - h0) * 1000).toFixed(1)} mm from where they began`);
  }
  ok(worst <= 1.5e-3, `every number within a millimetre and a half (worst ${(worst * 1000).toFixed(2)} mm)`);
  // The two clips lined up by their hips, and each drawn with its own wall on the face.
  const up = WALL_FACTS.climbing_up_wall;
  const down = WALL_FACTS.climbing_down_wall;
  ok(Math.abs(clipLift(down) + (down.hips - up.hips)) < 1e-12 && clipLift(up) === 0, `the down clip is drawn ${clipLift(down).toFixed(3)} m lower than authored, its hips on the up clip's`);
  ok(Math.abs(clipWall(up) - up.hand - PALM_OFF) < 1e-12 && Math.abs(clipWall(down) - down.hand - PALM_OFF) < 1e-12 && up.foot + 0.04 > clipWall(up) && down.foot + 0.04 > clipWall(down), `each clip's own wall stands at its planted palms (up ${clipWall(up).toFixed(3)} m ahead of its origin, down ${clipWall(down).toFixed(3)}), its feet's soles a few centimetres past it for the knees to take up`);
}
console.log(`wallClips: ${checks} checks passed`);
