// The stairs wave, part B: the stair clips trimmed to one step a stair and the downstairs steps mirrored
// (`src/anim/stairCycle.ts`), on the human male (the converted one where the packs are here, else the tests' own skeleton):
//  - each clip's window (`STAIR_WINDOWS`) found again by the very search that made the table (`stairCycleSearch.ts`), and
//    its seam before it is spread, its worst point against the hips, said;
//  - every cycle built closes on itself (its legs' worst point against the hips across the loop under a millimetre) and
//    turns no faster at its seam than the clip turns anywhere of its own;
//  - every cycle steps twice a loop, a foot each, half a loop apart, and its step's measure (`fwd`, `rise`) said;
//  - the three mirror settings: 'legs' (the second step the first with the legs and hips mirrored, the head where the clip
//    has it), 'whole' (the whole body mirrored, the head too) and 'off' (the clip as it stands: no cycle taken);
//  - and under `stairs.cycle` 'before' no cycle is taken, up or down.
//
// Run: node tools/swg/tests/stairCycles.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { STAIR_WINDOWS, cycleName, roughness, seamOf, windowSeam } from '../../../src/anim/stairCycle.ts';
import { MADE_STAIRS_DOWN, MADE_STAIRS_UP, cycleKindOf, stairCyclePick, type LocoPick } from '../../../src/anim/locoTable.ts';
import { searchWindow } from './stairCycleSearch.ts';
import * as W from './stairsWaveBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const { clips, cycles } = await W.clipsAndCycles();
const byName = new Map([...clips, ...cycles.clips].map((c) => [c.name, c]));
const skel = W.target as never;
if (!W.converted) note('the human male is not converted here: the tests\' own skeleton stands in, and the windows are only measured, not held to the table');

// ---- the windows ---------------------------------------------------------------------------------------------------------------
for (const [id, win] of Object.entries(STAIR_WINDOWS)) {
  const clip = byName.get(`mx_${id}`);
  ok(!!clip, `the pack's ${id} is fitted to the figure`);
  if (!clip) continue;
  const found = searchWindow(clip, skel, win.one);
  const raw = windowSeam(clip, skel, 0, clip.duration, win.one);
  const there = windowSeam(clip, skel, win.t0, win.t1, win.one);
  if (W.converted) ok(found.t0 === win.t0 && found.t1 === win.t1, `${id}: the search finds the table's window again, ${win.t0} to ${win.t1} s of ${clip.duration.toFixed(3)} (${win.one ? 'one footfall, mirrored' : 'two footfalls'})`);
  ok(there.gap <= raw.gap + 1e-4, `${id}: its seam before it is spread is ${(there.gap * 1000).toFixed(1)} mm and ${there.vel.toFixed(2)} m/s (the whole clip's ${(raw.gap * 1000).toFixed(1)} mm and ${raw.vel.toFixed(2)} m/s)`);
}

// ---- the cycles ---------------------------------------------------------------------------------------------------------------
const made: { id: string; kind: string }[] = [];
for (const [id, win] of Object.entries(STAIR_WINDOWS)) for (const kind of win.one ? ['legs', 'whole'] : ['trimmed']) made.push({ id, kind });
for (const { id, kind } of made) {
  const name = cycleName(id, kind as never);
  const c = byName.get(name);
  const f = cycles.facts.get(name);
  ok(!!c && !!f, `${name} is built and measured`);
  if (!c || !f) continue;
  const raw = byName.get(`mx_${id}`)!;
  const s = seamOf(c, skel);
  const rough = roughness(raw, skel);
  ok(s.gap < 0.001, `${name}: it closes on itself (its legs' worst point against the hips across the loop ${(s.gap * 1000).toFixed(2)} mm)`);
  ok(s.vel <= rough, `${name}: and turns at its seam no faster than the clip does anywhere of its own (${s.vel.toFixed(2)} m/s against ${rough.toFixed(2)})`);
  const half = Math.abs(((f.at[1] - f.at[0] + c.duration) % c.duration) - c.duration / 2);
  ok(f.steps === 2 && f.side[0] !== f.side[1] && half <= 0.15 * c.duration, `${name}: two footfalls a loop of ${c.duration.toFixed(3)} s, a foot each, at ${f.at[0].toFixed(3)} and ${f.at[1].toFixed(3)} s`);
  note(`${name}: its step goes ${(f.fwd * 100).toFixed(1)} cm along and ${(f.rise * 100).toFixed(1)} cm up, a foot landing ${(f.off[0] * 100).toFixed(1)} cm ahead of the hips (its middle ${(f.mid[0] * 100).toFixed(1)} cm on); ${f.run ? 'a running clip' : 'a walking clip'}`);
  if (kind === 'trimmed') ok(c.duration <= raw.duration + 1e-9, `${name} is the clip's window: ${c.duration.toFixed(3)} s of ${raw.duration.toFixed(3)} (a clip up is its own two steps whole, its seam spread)`);
}

// ---- the mirror settings ------------------------------------------------------------------------------------------------------
{
  const fig = W.figure();
  const at = (clip: THREE.AnimationClip, t: number, joint: string) => {
    fig.mixer.stopAllAction();
    const a = fig.mixer.clipAction(clip);
    a.reset().play();
    a.time = t;
    fig.mixer.update(0);
    fig.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    fig.bones.get(joint)!.getWorldPosition(v);
    const r = new THREE.Vector3();
    fig.bones.get('root')!.getWorldPosition(r);
    return v.sub(r);
  };
  const turnAt = (clip: THREE.AnimationClip, t: number, joint: string) => {
    at(clip, t, joint);
    return fig.bones.get(joint)!.getWorldQuaternion(new THREE.Quaternion());
  };
  const mirrored = (v: THREE.Vector3) => new THREE.Vector3(-v.x, v.y, v.z);
  for (const id of Object.keys(STAIR_WINDOWS).filter((k) => STAIR_WINDOWS[k].one)) {
    for (const kind of ['legs', 'whole']) {
      const c = byName.get(cycleName(id, kind as never));
      if (!c) continue;
      const h = c.duration / 2;
      let legs = 0;
      let head = 0;
      let headMirror = 0;
      for (let i = 0; i < 12; i++) {
        const t = (i / 12) * h;
        legs = Math.max(legs, at(c, t + h, 'lAnkle').distanceTo(mirrored(at(c, t, 'rAnkle'))), at(c, t + h, 'rAnkle').distanceTo(mirrored(at(c, t, 'lAnkle'))));
        for (const j of ['spine2', 'spine3', 'neck', 'Head']) head = Math.max(head, turnAt(c, t + h, j).angleTo(turnAt(c, t, j)));
        headMirror = Math.max(headMirror, at(c, t + h, 'Head').distanceTo(mirrored(at(c, t, 'Head'))));
      }
      ok(legs < 0.01, `${id} '${kind}': the second step's ankles are the first's mirrored (worst ${(legs * 1000).toFixed(1)} mm against the hips)`);
      if (kind === 'legs') ok(head < 0.01, `${id} 'legs': the chest, neck and head keep the clip's own turns in the world in both steps (worst ${((head * 180) / Math.PI).toFixed(2)} degrees apart)`);
      else ok(headMirror < 0.01 && head > 0.02, `${id} 'whole': the head is mirrored with the rest (worst ${(headMirror * 1000).toFixed(1)} mm against the hips; turned up to ${((head * 180) / Math.PI).toFixed(1)} degrees off its own)`);
    }
  }
}

// ---- which clip a pick plays ---------------------------------------------------------------------------------------------------
{
  const up = { id: 'ascending_stairs', clip: 'mx_ascending_stairs', made: MADE_STAIRS_UP } as unknown as LocoPick;
  const down = { id: 'descending_stairs_1', clip: 'mx_descending_stairs_1', made: MADE_STAIRS_DOWN } as unknown as LocoPick;
  ok(cycleKindOf(up, 'trimmed', 'legs') === 'trimmed' && cycleKindOf(down, 'trimmed', 'legs') === 'legs' && cycleKindOf(down, 'trimmed', 'whole') === 'whole', `under 'trimmed' a pick up plays its trimmed cycle and one down the mirror asked`);
  ok(cycleKindOf(down, 'trimmed', 'off') === null, `mirror 'off': a pick down plays the clip as it stands`);
  ok(cycleKindOf(up, 'before', 'legs') === null && cycleKindOf(down, 'before', 'whole') === null, `under 'before' no cycle is taken, up or down`);
  const twin = stairCyclePick(up, 'trimmed');
  ok(twin.clip === 'mx_ascending_stairs~trimmed' && stairCyclePick(up, 'trimmed') === twin && twin.id === up.id, `a cycle's pick is the pick's own twin, made once (${twin.clip})`);
}
console.log(`stairCycles: ${checks} checks passed`);
