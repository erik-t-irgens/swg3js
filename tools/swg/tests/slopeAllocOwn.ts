// The slope limit's own frame (wave 2b's review round): `SlopeRule.controllerFor` and `judge`, the two calls the player's
// update makes every frame a body is on its feet, replayed over walks the grapple's harness records on the real Rapier
// (standing on flat ground, walking on it, walking over rolling terrain), and under the rule 'before'. What it makes is
// measured with no collection between, and what it asks of the engine counted: the engine's own answers are its cost
// (about 800 bytes a ray that meets something), so the rule is held to asking as seldom as it says and making nothing
// else. Run twelve at once by `slopeAlloc.test.ts`; prints one line of JSON.
//
// The frame is a function of its own reading kept arrays, called from a loop kept out of the optimizer, so no number of
// the measure's crosses a call (wave 2a's lesson: an allocation harness calls a frame function of its own).
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import * as harness from './grappleBody.ts';
import { SlopeRule } from '../../../src/player/slopeRule.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';
import type { Physics } from '../../../src/core/physics.ts';

const { makePhysics, ground, heightChunk } = harness;
let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

/** A walk recorded: the feet and the verdict each frame, how far it went. */
interface Recorded {
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  pg: Uint8Array;
  metres: number;
  offsetY: number;
  filter: number;
}
async function record(p: Physics, x: number, y: number, z: number, settle: number, walk: number): Promise<{ rec: Recorded; b: InstanceType<typeof harness.TestBody> }> {
  LOCO_TUNE.slopeRule = 'limit';
  const b = new harness.TestBody(p);
  b.forward.set(1, 0, 0);
  b.right.set(0, 0, 1);
  b.place(x, y, z);
  b.run(60, settle);
  const n = Math.round(walk * 60);
  const rec: Recorded = { px: new Float64Array(n), py: new Float64Array(n), pz: new Float64Array(n), pg: new Uint8Array(n), metres: 0, offsetY: b.colliderOffsetY, filter: b.filter };
  if (walk > 3) b.key('KeyW', true);
  for (let i = 0; i < n; i++) {
    b.frame(1 / 60);
    rec.px[i] = b.pos.x;
    rec.py[i] = b.pos.y;
    rec.pz[i] = b.pos.z;
    rec.pg[i] = b.grounded ? 1 : 0;
    if (i > 0) rec.metres += Math.hypot(rec.px[i] - rec.px[i - 1], rec.pz[i] - rec.pz[i - 1]);
  }
  b.key('KeyW', false);
  return { rec, b };
}

/** The replay's state: which recording, which frame. Fields, so nothing crosses a call. */
class Replay {
  rec: Recorded | null = null;
  i = 0;
  n = 0;
  rule = new SlopeRule();
  world: Physics['world'] | null = null;
  body: InstanceType<typeof harness.TestBody>['body'] | null = null;
  controller: InstanceType<typeof harness.TestBody>['controller'] | null = null;
  pass: (c: unknown) => boolean = () => true;
}
const st = new Replay();
function frame(): void {
  const rec = st.rec!;
  const i = st.i;
  const s = st.rule;
  s.controllerFor(st.controller!);
  const at = s.at;
  at.x = rec.px[i];
  at.y = rec.py[i];
  at.z = rec.pz[i];
  at.offsetY = rec.offsetY;
  at.r = 0.35;
  at.filter = rec.filter;
  s.judge(st.world!, rec.pg[i] === 1, true, st.body!, st.pass as never);
  st.i = i + 1 === st.n ? 0 : i + 1;
}
function run(n: number): void {
  for (let k = 0; k < n; k++) frame();
}
// The loop is kept out of the optimizer so it builds nothing of `frame` into itself; `frame` is compiled as itself.
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(run)');

/** Replays a recording through the rule over and over (30,000 frames to warm it), then measures enough passes for `WINDOW` frames with no collection. */
async function measure(rec: Recorded, b: InstanceType<typeof harness.TestBody>, rule: 'limit' | 'before'): Promise<{ bytes: number; casts: number; frames: number; clean: boolean }> {
  LOCO_TUNE.slopeRule = rule;
  st.rec = rec;
  st.n = rec.px.length;
  st.i = 0;
  st.rule = new SlopeRule();
  st.world = b.physics.world;
  st.body = b.body;
  st.controller = b.controller;
  st.pass = b.walkPast as never;
  run(Math.ceil(30000 / st.n) * st.n);
  const passes = Math.ceil(WINDOW / st.n);
  let best = { bytes: Number.POSITIVE_INFINITY, casts: 0, frames: st.n, clean: false };
  for (let tries = 0; tries < 4; tries++) {
    st.i = 0;
    run(st.n);
    globalThis.gc!({ type: 'minor' } as never);
    await turn();
    await turn();
    const s0 = scavenges;
    const c0 = st.rule.casts;
    const y0 = young();
    run(st.n * passes);
    const y1 = young();
    await turn();
    await turn();
    if (scavenges === s0 && y1 - y0 < best.bytes) best = { bytes: y1 - y0, casts: st.rule.casts - c0, frames: st.n * passes, clean: true };
  }
  return best;
}

/** Frames measured at once, at the least: the measure's own few kilobytes a window (the 'before' replay's) are then under 0.05 a frame. */
const WINDOW = 60000;
const flat = await makePhysics();
ground(flat, 0);
flat.stepOnce();
const stand = await record(flat, 0, 0.02, 0.3, 1, 3);
const flat2 = await makePhysics();
ground(flat2, 0);
flat2.stepOnce();
const walk = await record(flat2, 0, 0.02, 0.3, 1, 8);
const rolling = await makePhysics();
heightChunk(rolling, 0, -32, (x, z) => 3 + 2 * Math.sin(x / 7) * Math.cos(z / 9) + 0.5 * Math.sin(x / 3));
rolling.stepOnce();
const roll = await record(rolling, 6, 8, 3.3, 1.5, 8);

const s = await measure(stand.rec, stand.b, 'limit');
const w = await measure(walk.rec, walk.b, 'limit');
const r = await measure(roll.rec, roll.b, 'limit');
const before = await measure(walk.rec, walk.b, 'before');
console.log(
  JSON.stringify({
    standFrames: s.frames, standBytes: s.bytes, standCasts: s.casts, standClean: s.clean,
    walkFrames: w.frames, walkBytes: w.bytes, walkCasts: w.casts, walkClean: w.clean, walkMetres: walk.rec.metres, walkPasses: w.frames / walk.rec.px.length,
    rollFrames: r.frames, rollBytes: r.bytes, rollCasts: r.casts, rollClean: r.clean, rollMetres: roll.rec.metres, rollPasses: r.frames / roll.rec.px.length, rollGrounded: roll.rec.pg.reduce((a, v) => a + v, 0),
    beforeFrames: before.frames, beforeBytes: before.bytes, beforeCasts: before.casts, beforeClean: before.clean,
  }),
);
flat.world.free();
flat2.world.free();
rolling.world.free();
