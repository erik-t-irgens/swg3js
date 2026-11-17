// The stairs wave of the animations, day one: with its switches at 'before' (`ik.hips`, `stairs.cycle`, `stairs.stepRule`,
// `stairs.pin` 'off'), the body is 9c18665's own to the bit, that commit's modules read out of git (a recorded digest where
// git cannot answer):
//  - the player's record (`BodyLoco`) and another player's (`PeerLoco`) over a walk, a jog and a run up and down measured
//    stairs (tread, riser, the next riser, the distance gone and the legs' clip's time all handed in, and a rig that has the
//    trimmed cycles), at 30, 60 and 144 frames a second, every number by `Object.is`;
//  - the feet (`FootIk`) and the stairs' sampler (`StairSense`, measuring as the game asks it to: not under 'before') over a figure walked up a staircase and its landing
//    on the real Rapier at 30, 60 and 144 frames a second: every leg bone's turn, the drop and the feet's weight, and the
//    sampler's own fields, every number by `Object.is`;
//  - and under the switches as shipped both do change (the cycles, the step's speed and rate, the steady hips), so the
//    checks above are not blind.
//
// Run: node tools/swg/tests/stairsDayOne.test.ts (SWG3JS_NO_OLD=1 holds it to the recorded digests alone)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { BodyLoco, newLocoIn, type LocoIn, type LocoRig } from '../../../src/anim/bodyLoco.ts';
import { PeerIn, PeerLoco } from '../../../src/anim/peerLoco.ts';
import { LOCO_TUNE_SHIPPED, type LocoTune } from '../../../src/anim/locoTune.ts';
import { FootIk } from '../../../src/player/footIk.ts';
import { StairSense } from '../../../src/player/stairSense.ts';
import type { StairCycleFacts } from '../../../src/anim/stairCycle.ts';
import { Physics, RAPIER, TRIMESH_FLAGS, cleanTrimesh, Group, groups } from '../../../src/core/physics.ts';
import { loadOldMany } from './oldModules.ts';
import { figure } from './stairsWaveBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const PRE_WAVE = '9c18665';
/** The digests of the day-one traces under 9c18665's own modules (what a checkout with no history is held to). */
const LOCO_TRACE = 'ba539f42e0986403';
const FEET_TRACE = '470d27dc2af87366';

const T = (): LocoTune => JSON.parse(JSON.stringify(LOCO_TUNE_SHIPPED)) as LocoTune;
const before = (): LocoTune => {
  const t = T();
  t.ik.hips = 'before';
  t.stairs.cycle = 'before';
  t.stairs.stepRule = 'before';
  t.stairs.pin = 'off';
  // And Stairs II's switches and dials at 33d3e67's (which were 9c18665's): the hold, the longest riser and tread, the window,
  // the mirror and the step-up. Their own day one is stairsTwo.test.ts.
  t.stairs.hold = 'before';
  t.stairs.riserMax = 0.5;
  t.stairs.treadMax = 4;
  t.stairs.look = 1.6;
  t.stairs.mirror = 'legs';
  t.step.rule = 'before';
  return t;
};
const n = (v: unknown) => (typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(v)) : String(v));
const digest = (rows: string[]) => createHash('sha1').update(rows.join('\n')).digest('hex').slice(0, 16);

// ---- the records ---------------------------------------------------------------------------------------------------------------
/** A stair cycle's facts as the rig hands them (synthetic: every name a cycle). */
const facts = (name: string): StairCycleFacts => ({ name, len: 1.2, steps: 2, at: new Float64Array([0.2, 0.8]), side: new Int8Array([0, 1]), off: new Float64Array([0.2, 0.2]), mid: new Float64Array([0.08, 0.08]), run: /run/.test(name), fwd: 0.26, rise: 0.2, seam: 0, seamVel: 1 }) as unknown as StairCycleFacts;
const rig: LocoRig = { has: () => true, speedOut: 0, readSpeed() { this.speedOut = 3; return true; }, stairFacts: (c: string) => facts(c) } as LocoRig;
type Loco = InstanceType<typeof BodyLoco>;
type Mods = { BodyLoco: new (t: never) => Loco; newLocoIn: () => LocoIn; PeerLoco: new () => InstanceType<typeof PeerLoco>; PeerIn: new () => PeerIn };

function locoTrace(mods: Mods, tune: unknown): string[] {
  const rows: string[] = [];
  for (const fps of [30, 60, 144]) {
    for (const way of [1, -1]) {
      for (const gait of ['walk', 'jog', 'run']) {
        const b = new mods.BodyLoco(tune as never);
        const f = mods.newLocoIn() as LocoIn & Record<string, unknown>;
        f.sprint = 6.35;
        f.pool = 100;
        let time = 0;
        for (let i = 0; i < Math.round(1.5 * fps); i++) {
          const dt = 1 / fps;
          b.keys(dt, gait === 'run', gait === 'run' && i === 0, gait === 'walk', rig);
          Object.assign(f, { dt, mz: 1, mx: 0, standing: true, grounded: true, swimming: false, fighting: false, aiming: false, gunUp: false, fightKeys: false, boost: 1, ground: 0, stairs: way });
          Object.assign(f, { stairKnown: true, stairTread: 0.28, stairRiser: 0.17, stairNext: 0.28 - ((i * 0.013) % 0.28), stairMoved: 0, legTime: Number.NaN });
          b.plan(f);
          f.ground = b.speed * 0.97;
          Object.assign(f, { stairMoved: b.speed * dt, legTime: i === 0 ? Number.NaN : time });
          const legs = b.legs(rig, f, false);
          time += dt * b.rate;
          rows.push([fps, way, gait, b.cls, b.speed, b.pick?.id ?? '-', b.pick?.clip ?? '-', b.legsOn, b.rate, legs?.id ?? '-', legs?.clip ?? '-'].map(n).join(' '));
        }
      }
    }
  }
  for (const state of ['walk', 'run']) {
    for (const way of [1, -1]) {
      const p = new mods.PeerLoco();
      const f = new mods.PeerIn() as PeerIn & Record<string, unknown>;
      for (let i = 0; i < 180; i++) {
        const speed = state === 'walk' ? 0.8 : 3.2;
        f.vx = 0;
        f.vz = speed;
        f.heading = 0;
        f.speed = speed;
        f.dt = 1 / 60;
        Object.assign(f, { stairs: way, stairKnown: true, stairTread: 0.28, stairRiser: 0.17, stairNext: 0.2, stairMoved: speed / 60, legTime: Number.NaN, legClip: '' });
        const got = p.resolve(tune as never, rig, state, f);
        rows.push([state, way, got?.id ?? '-', got?.clip ?? '-', p.rate, p.rel].map(n).join(' '));
      }
    }
  }
  return rows;
}

{
  const FILES = ['src/anim/bodyLoco.ts', 'src/anim/locoClass.ts', 'src/anim/locoTable.ts', 'src/anim/locoTune.ts', 'src/anim/peerLoco.ts'];
  const old = await loadOldMany(FILES, ['src/anim/bodyLoco.ts', 'src/anim/peerLoco.ts'], PRE_WAVE);
  const today: Mods = { BodyLoco: BodyLoco as never, newLocoIn, PeerLoco, PeerIn };
  const off = locoTrace(today, before());
  const shipped = locoTrace(today, T());
  const d = digest(off);
  if (old) {
    const [ob, op] = old as [{ BodyLoco: new (t: never) => Loco; newLocoIn: () => LocoIn }, { PeerLoco: new () => InstanceType<typeof PeerLoco>; PeerIn: new () => PeerIn }];
    // `stairs.pace` changed its meaning in the wave (the share of the class's speed over the clip's own pace, 0.25): 9c18665's
    // was a factor on the class's speed, shipped at 1, which is what 'before' plays.
    const thenTune = before();
    thenTune.stairs.pace = 1;
    const then = locoTrace({ BodyLoco: ob.BodyLoco, newLocoIn: ob.newLocoIn, PeerLoco: op.PeerLoco, PeerIn: op.PeerIn }, thenTune);
    const a = off;
    const b = then;
    const at = a.findIndex((r, i) => r !== b[i]);
    ok(a.length === b.length && at < 0, `day one: with the switches at 'before' the records over measured stairs, up and down, walking, jogging and running, and another player's, are ${PRE_WAVE}'s at 30, 60 and 144 frames a second (${a.length} rows, every number by Object.is)${at >= 0 ? `: row ${at} is ${a[at]} against ${b[at]}` : ''}`);
    note(`the records' trace digest is ${d} (LOCO_TRACE)`);
  } else note(`git cannot hand over ${PRE_WAVE}'s modules here: the records' trace is held to the digest recorded from them`);
  ok(d === LOCO_TRACE, `and its digest is the one recorded from ${PRE_WAVE}'s own modules (${d})`);
  const first = shipped.findIndex((r, i) => r !== off[i]);
  ok(first >= 0 && shipped.some((r) => /~trimmed|~legs/.test(r)) && shipped.some((r, i) => r.split(' ')[4] !== off[i].split(' ')[4]), `and under the switches as shipped the records do change (from row ${first}: the trimmed and mirrored cycles, the step's speed and rate), so the check is not blind`);
}

// ---- the feet and the sampler ---------------------------------------------------------------------------------------------------
function box(p: Physics, min: number[], max: number[]): void {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const c = cleanTrimesh(new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]), new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]))!;
  const dsc = RAPIER.ColliderDesc.trimesh(c.vertices, c.indices, TRIMESH_FLAGS);
  dsc.setCollisionGroups(groups(Group.exterior, Group.all));
  p.world.createCollider(dsc);
}
type FeetMods = { FootIk: typeof FootIk; StairSense: typeof StairSense };
async function feetTrace(mods: FeetMods, tune: LocoTune): Promise<string[]> {
  const rows: string[] = [];
  const p = await Physics.create();
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(200, 1, 200).setTranslation(0, -1, 0)).setCollisionGroups(groups(Group.terrain, Group.all));
  for (let i = 0; i < 6; i++) box(p, [2 + i * 0.3, 0, -2], [2 + (i + 1) * 0.3, (i + 1) * 0.2, 2]);
  box(p, [3.8, 0, -2], [5.8, 1.2, 2]);
  p.stepOnce();
  const ALL = groups(Group.all, Group.all);
  const LEG = ['lThigh', 'lShin', 'lAnkle', 'lToe', 'rThigh', 'rShin', 'rAnkle', 'rToe', 'root'];
  for (const fps of [30, 60, 144]) {
    const fig = figure();
    const feet = new mods.FootIk(tune.ik, () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
    const sense = new mods.StairSense();
    const dt = 1 / fps;
    const frames = Math.round(5 * fps);
    for (let i = 0; i < frames; i++) {
      const x = -0.5 + i * dt;
      const y = x < 2 ? 0 : x < 3.8 ? Math.min(6, Math.floor((x - 2) / 0.3) + 1) * 0.2 : 1.2;
      // The rest pose with the legs swung a little (so a foot rises and plants), the root bobbing.
      for (const s of ['l', 'r']) {
        const th = fig.bones.get(`${s}Thigh`)!;
        th.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.35 * Math.sin(i * dt * 6 + (s === 'l' ? 0 : Math.PI)));
      }
      fig.root.position.set(x, y, 0);
      fig.root.rotation.set(0, Math.PI / 2, 0);
      fig.root.updateMatrixWorld(true);
      const a = sense.at as unknown as Record<string, unknown>;
      Object.assign(a, { x, y, z: 0, vx: 1, vz: 0, dt, filter: ALL, reads: true, measure: tune.ik.hips === 'steady' || tune.stairs.stepRule === 'stairs' });
      sense.step(p.world as never, tune.stairs);
      const fi = feet.in as unknown as Record<string, unknown>;
      Object.assign(fi, { dt, on: true, stairClip: false, px: x, py: y, pz: 0, heading: Math.PI / 2, filter: ALL, stride: 1, clear: 0, pin: false });
      const sr = sense as unknown as Record<string, unknown>;
      Object.assign(fi, { stairKnown: sr.known ?? false, stairTread: sr.tread ?? 0, stairRiser: sr.riser ?? 0, stairNext: sr.next ?? Number.NaN, stairPrev: sr.prev ?? Number.NaN, stairFloor: sr.floor ?? Number.NaN, ux: sr.ux ?? 0, uz: sr.uz ?? 0 });
      feet.step(fig.rig as never, p.world as never, null);
      const out: unknown[] = [fps, i];
      for (const name of LEG) {
        const bn = fig.bones.get(name);
        if (!bn) continue;
        out.push(bn.quaternion.x, bn.quaternion.y, bn.quaternion.z, bn.quaternion.w);
      }
      out.push(fig.root.position.y, feet.drop, feet.weight, sense.way, sense.casts);
      rows.push(out.map(n).join(' '));
    }
  }
  return rows;
}
{
  const FILES = ['src/player/footIk.ts', 'src/player/stairSense.ts', 'src/anim/stairsRule.ts', 'src/anim/locoTune.ts'];
  const old = await loadOldMany(FILES, ['src/player/footIk.ts', 'src/player/stairSense.ts'], PRE_WAVE);
  const off = await feetTrace({ FootIk, StairSense }, before());
  const d = digest(off);
  if (old) {
    const [of, os] = old as [{ FootIk: typeof FootIk }, { StairSense: typeof StairSense }];
    const thenTune = before();
    const then = await feetTrace({ FootIk: of.FootIk, StairSense: os.StairSense }, thenTune);
    const at = off.findIndex((r, i) => r !== then[i]);
    ok(off.length === then.length && at < 0, `day one: with the hips at 'before' (the stride whole, no clearance, no hold) the feet and the stairs' sampler over a figure walked up a staircase and its landing are ${PRE_WAVE}'s at 30, 60 and 144 frames a second (${off.length} rows: every leg bone's turn, the root, the drop, the weight, the sampler's way and casts, by Object.is)${at >= 0 ? `: row ${at} is ${off[at]} against ${then[at]}` : ''}`);
    note(`the feet's trace digest is ${d} (FEET_TRACE)`);
  } else note(`git cannot hand over ${PRE_WAVE}'s modules here: the feet's trace is held to the digest recorded from them`);
  ok(d === FEET_TRACE, `and its digest is the one recorded from ${PRE_WAVE}'s own modules (${d})`);
  const shipped = await feetTrace({ FootIk, StairSense }, T());
  const first = shipped.findIndex((r, i) => r !== off[i]);
  ok(first >= 0, `and with the hips steady (as shipped) the feet do change (from row ${first}), so the check is not blind`);
}
console.log(`stairsDayOne: ${checks} checks passed`);
