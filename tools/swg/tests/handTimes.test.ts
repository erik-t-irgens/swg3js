// Climbing II, Smoothness II, item 1: each hop's, grab's and drop's clip measured again by its hands' own speed
// (src/anim/handTimes.ts, `measureHands`) from the very clips the pack fits for the converted human male, the way
// `HAND_MEASURED` was first made, every moment within half of one of the clip's own frames; the owner's timings
// (`HAND_OWNER`) beside them, and every clip whose measure differs from his by more than two frames reported with both (his
// win: the game reads `handMoment`, his where he gave one). The rule itself on samples made up here (a hand at rest, a hop,
// a grab arriving, the pack's ramp added back), so it is held where there are no packs too.
//
// Run: node tools/swg/tests/handTimes.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { MixamoPack } from '../../../src/anim/mixamoPack.ts';
import { LEDGE_FACTS, ledgeClipName } from '../../../src/anim/ledgeClips.ts';
import { HAND_KINDS, HAND_MEASURED, HAND_OWNER, handMoment, measureHands } from '../../../src/anim/handTimes.ts';
import { glbSkeleton, speciesBodies } from './animFixtures.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

// ---- the rule on made-up samples ------------------------------------------------------------------------------------------
{
  const dt = 1 / 30;
  const n = 40;
  // A hop: both hands still to frame 10, flying sideways at 3 m/s to frame 20, still after; the left hand lands two frames
  // after the right.
  const l: number[] = [];
  const r: number[] = [];
  for (let k = 0; k < n; k++) {
    const fl = Math.min(Math.max(k - 10, 0), 12) * 0.1;
    const fr = Math.min(Math.max(k - 10, 0), 10) * 0.1;
    l.push(0.3 + fl, 2, 0.35);
    r.push(-0.3 + fr, 2, 0.35);
  }
  const a: number[] = [];
  for (let k = 0; k < n; k++) a.push(0, 0.8, 0.3);
  const m = measureHands({ dt, l, r, a, driftX: 0, driftZ: 0, kind: 'hop' });
  ok(Math.abs(m.leave - 10 * dt) < 1e-9 && Math.abs(m.touch - 20 * dt) < 1e-9, `a hop's hands: leave at the last still frame (${m.leave.toFixed(3)}), touch where the first hand is still again (${m.touch.toFixed(3)})`);
  // The same hop with the pack's ramp taken off: the hands drift back at 1.5 m/s in the fitted clip, the measure the same.
  const ls = l.map((v, i) => (i % 3 === 0 ? v - 1.5 * dt * Math.floor(i / 3) : v));
  const rs = r.map((v, i) => (i % 3 === 0 ? v - 1.5 * dt * Math.floor(i / 3) : v));
  const ms = measureHands({ dt, l: ls, r: rs, a, driftX: 1.5, driftZ: 0, kind: 'hop' });
  ok(Math.abs(ms.leave - m.leave) < 1e-9 && Math.abs(ms.touch - m.touch) < 1e-9, 'the ramp the pack took off is added back: the same moments');
  const raw = measureHands({ dt, l: ls, r: rs, a, driftX: 0, driftZ: 0, kind: 'hop' });
  ok(raw.leave === 0, 'without it the drift alone reads as hands moving from the start (the rule needs the ramp)');
  // A grab: arriving at 5 m/s, still from frame 8.
  const g: number[] = [];
  for (let k = 0; k < n; k++) g.push(0, 2, Math.max(0, 8 - k) * 0.16);
  const mg = measureHands({ dt, l: g, r: g, a, driftX: 0, driftZ: 0, kind: 'air' });
  ok(!(mg.leave === mg.leave) && Math.abs(mg.touch - 8 * dt) < 1e-9, `a grab arriving: no leave, touch where the hands stop (${mg.touch.toFixed(3)})`);
  ok(handMoment('braced_hang_hop_up', 'leave') === HAND_OWNER.braced_hang_hop_up.leave && handMoment('braced_hang', 'touch') === HAND_MEASURED.braced_hang.touch && handMoment('jump_to_hang', 'touch') === HAND_OWNER.jump_to_hang.touch, "the game's moments: the owner's where he gave one, else the measure's");
  ok(!(handMoment('jumping_to_hanging', 'leave') === handMoment('jumping_to_hanging', 'leave')) && !(handMoment('no_such_clip', 'touch') === handMoment('no_such_clip', 'touch')), 'none where neither gives one (a grab that starts in the air has no leave)');
}

// ---- the measure from the pack ----------------------------------------------------------------------------------------------
const ids = Object.keys(HAND_MEASURED);
ok(Object.keys(HAND_OWNER).every((id) => id in HAND_MEASURED) && ids.every((id) => id in HAND_KINDS), "every clip of the owner's table is measured too, and every clip measured has its kind");
const packDir = join(REPO, 'public', 'anims', 'mixamo');
const index = JSON.parse(readFileSync(join(packDir, 'index.json'), 'utf8')) as { clips: { id: string; loop: boolean; travelNet: number[]; duration: number; frames: number }[] };
const rowOf = (id: string) => index.clips.find((c) => c.id === id) ?? null;
ok(ids.every((id) => !!rowOf(id)), `the pack holds every clip measured (${ids.length})`);
const body = speciesBodies(REPO).find((b) => b.id === 'human_male');
if (!body) {
  note("no converted human male here: the measure's numbers are his and are not measured again");
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
    also: ids,
    now: () => performance.now(),
  });
  const info = console.info;
  console.info = () => {};
  const clips = await pack.clipsFor(target as never, 'hands');
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
  const table: string[] = [];
  let worst = 0;
  let worstAt = '';
  const far: string[] = [];
  for (const id of ids) {
    const clip = clips.find((c) => c.name === ledgeClipName(id))!;
    const row = rowOf(id)!;
    mixer.stopAllAction();
    const act = mixer.clipAction(clip);
    act.reset().play();
    const T = clip.duration;
    const n = Math.round(T * 30);
    const dt = T / n;
    const l: number[] = [];
    const r: number[] = [];
    const a: number[] = [];
    for (let k = 0; k <= n; k++) {
      act.time = Math.min(T - 1e-5, k * dt);
      mixer.update(0);
      root.updateMatrixWorld(true);
      l.push(...grip('l'));
      r.push(...grip('r'));
      const la = P('lAnkle');
      const ra = P('rAnkle');
      a.push((la[0] + ra[0]) / 2, (la[1] + ra[1]) / 2, (la[2] + ra[2]) / 2);
    }
    const net = row.travelNet.map((x) => x * scale);
    const m = measureHands({ dt, l, r, a, driftX: net[0] / T, driftZ: net[2] / T, kind: HAND_KINDS[id] });
    const want = HAND_MEASURED[id];
    for (const k of ['leave', 'touch'] as const) {
      const got = m[k];
      const w = want[k];
      const d = got === got && w === w ? Math.abs(got - w) : got === got || w === w ? Infinity : 0;
      if (d > worst) {
        worst = d;
        worstAt = `${id}.${k} ${got.toFixed(3)} against ${w}`;
      }
    }
    const o = HAND_OWNER[id];
    const f = (x: number) => (x === x ? x.toFixed(3) : '-');
    table.push(`${id.padEnd(24)} measured ${f(m.leave)} ${f(m.touch)}  owner ${o ? `${f(o.leave)} ${f(o.touch)}` : '-'}`);
    if (o) {
      for (const k of ['leave', 'touch'] as const) {
        if (o[k] === o[k] && m[k] === m[k] && Math.abs(o[k] - m[k]) > 2 * dt + 1e-9) far.push(`${id} ${k}: the owner's ${o[k].toFixed(2)}, measured ${m[k].toFixed(3)} (${((m[k] - o[k]) / dt).toFixed(1)} frames)`);
      }
    }
    if (LEDGE_FACTS[id]) assert.ok(Math.abs(LEDGE_FACTS[id].dur - T) < 2e-3, `${id}'s length is the table's`);
  }
  console.log(table.join('\n'));
  for (const w of far) note(`differs by more than two frames: ${w} (the owner's wins)`);
  ok(worst <= 0.5 / 30 + 1e-6, `every clip measures again within half a frame of the table (worst ${(worst * 1000).toFixed(1)} ms${worstAt ? `, ${worstAt}` : ''})`);
}
console.log(`handTimes: ${checks} checks passed`);
