// Climbing II's feedback round, items 3 and 4: the body's shape's own frame (`BodyShape`) makes nothing. Measured over a
// stand-in world whose queries answer with kept objects (so what is counted is the shape's own code, and the engine's answers
// are the engine's), with no collection between, in the frames the game steps every frame on foot: standing still (asks
// nothing), walking in the open (one box over the path once a quarter metre or so, its clear answer kept between), walking under a beam (the box, the knee-height sweep and the columns),
// ducked and still under a roof, lying still, and lying while it turns (the turn's test). And on the real Rapier, what each of
// those asks of the engine a frame. Run twelve at once by `bodyShapeAlloc.test.ts`; prints one line of JSON. The frame is a
// function of its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson).
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import { box, ground, makePhysics } from './grappleBody.ts';
import { RAPIER } from '../../../src/core/physics.ts';
import { resetMoveTune } from '../../../src/anim/moveTune.ts';
import { BodyShape, ShapeIn, type ShapeCollider, type ShapeWorld } from '../../../src/player/bodyShape.ts';

resetMoveTune();
let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

const makers = { capsule: (h: number, r: number) => new RAPIER.Capsule(h, r), ball: (r: number) => new RAPIER.Ball(r), cuboid: (x: number, y: number, z: number) => new RAPIER.Cuboid(x, y, z) };

/** A stand-in world: kept answers, nothing made. `roof` the column casts' time of impact (or none), `zone` whether the box meets something. */
class Stand {
  zone = false;
  sweepToi = -1;
  upToi = 0.5;
  lyingMeets = false;
  readonly met = { contactShape: () => this.contact } as unknown as RAPIER.Collider;
  readonly contact = { distance: -0.01, normal1: { x: -1, y: 0, z: 0 } };
  readonly hit = { time_of_impact: 0.5 } as unknown as RAPIER.ColliderShapeCastHit;
  readonly sweep = { time_of_impact: 2 } as unknown as RAPIER.ColliderShapeCastHit;
  intersectionWithShape(_p: unknown, q: { y: number; x: number }): RAPIER.Collider | null {
    // The lying capsule's test carries a turn with x (laid over); the box over the path is turned about up alone.
    if (q.x !== 0) return this.lyingMeets ? this.met : null;
    return this.zone ? this.met : null;
  }
  castShape(_p: unknown, _q: unknown, v: { y: number }): RAPIER.ColliderShapeCastHit | null {
    // The answers' times are set with the scene, never per call, so the stand-in makes nothing of its own.
    if (v.y === 0) return this.sweepToi < 0 ? null : this.sweep;
    return this.upToi < 0 ? null : this.hit;
  }
}
const noCol: ShapeCollider = { setHalfHeight() {}, setRadius() {}, setRotationWrtParent() {}, setTranslationWrtParent() {}, setTranslation() {}, setRotation() {} };

class Run {
  world = new Stand();
  shape = new BodyShape(makers);
  f = new ShapeIn();
  lying = false;
  turning = false;
  yaw = 0;
  i = 0;
}
const st = new Run();
st.f.dt = 1 / 60;
st.f.feet = true;
st.f.scale = 1;
function frame(): void {
  const s = st;
  s.i++;
  if (s.lying) {
    // As the player's frame: the capsule held at the top, then the turn after the heading (here a heading swinging either way).
    const S = s.shape;
    S.holdLying(s.f, noCol);
    if (s.turning) {
      s.f.heading = (s.i & 1) === 0 ? 0.3 : -0.3;
      S.turnLyingIn(s.world as unknown as ShapeWorld, s.f, noCol);
    }
    return;
  }
  // The feet on along the way each frame, as a walk moves them (2 cm a frame: 3 m/s at 144 frames a second), so the path
  // box's clear answer is kept while the walk is inside what it covered and asked again past it (once in about 13 frames).
  s.f.z += 0.02;
  s.shape.stepUpright(s.world as unknown as ShapeWorld, s.f, noCol);
}
function run(n: number): void {
  for (let k = 0; k < n; k++) frame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(run)');

type Part = { bytes: number; asks: number; frames: number; clean: boolean };
async function measure(set: () => void, window: number): Promise<Part> {
  set();
  run(6000);
  let best: Part = { bytes: Number.POSITIVE_INFINITY, asks: 0, frames: window, clean: false };
  for (let tries = 0; tries < 4; tries++) {
    run(240);
    globalThis.gc!({ type: 'minor' } as never);
    await turn();
    await turn();
    const s0 = scavenges;
    const a0 = st.shape.asks;
    const y0 = young();
    run(window);
    const y1 = young();
    await turn();
    await turn();
    if (scavenges === s0 && y1 - y0 < best.bytes) best = { bytes: y1 - y0, asks: st.shape.asks - a0, frames: window, clean: true };
  }
  return best;
}
const W = 50000;
const still = await measure(() => {
  st.lying = false;
  st.f.vx = 0;
  st.f.vz = 0;
  st.f.moveX = 0;
  st.f.moveZ = 0;
  st.world.zone = false;
}, W);
const open = await measure(() => {
  st.f.vz = 3;
  st.f.moveZ = 1;
  st.world.zone = false;
}, W);
const under = await measure(() => {
  st.world.zone = true;
  st.world.sweepToi = -1;
  st.world.upToi = 0.5;
}, W);
const roofStill = await measure(() => {
  st.f.vz = 0;
  st.f.moveZ = 0;
}, W);
const lyingStill = await measure(() => {
  st.lying = true;
  st.turning = false;
}, W);
const lyingTurn = await measure(() => {
  st.turning = true;
  st.world.lyingMeets = true;
}, W);

// On the real Rapier: what each asks of the engine a frame.
const p = await makePhysics();
ground(p, 0);
box(p, [-3, 1.3, 4], [3, 1.6, 4.4], false);
p.stepOnce();
const real = new BodyShape(makers);
const rf = new ShapeIn();
rf.dt = 1 / 60;
rf.feet = true;
rf.filter = 0xffffffff;
const asked = (x: number, z: number, vz: number, n: number): number => {
  rf.x = x;
  rf.z = z;
  rf.vz = vz;
  rf.moveZ = vz > 0 ? 1 : 0;
  const a0 = real.asks;
  for (let k = 0; k < n; k++) real.stepUpright(p.world as unknown as ShapeWorld, rf, noCol);
  return (real.asks - a0) / n;
};
const realStill = asked(0, -6, 0, 60);
const realOpen = asked(0, -6, 3, 60);
const realUnder = asked(0, 3.5, 3, 60);
console.log(JSON.stringify({ still, open, under, roofStill, lyingStill, lyingTurn, realStill, realOpen, realUnder }));
