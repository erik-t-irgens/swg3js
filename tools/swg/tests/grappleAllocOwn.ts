// The grapple's own code over whole frames, with the engine's answers kept: test 17 (d) of `grapple.test.ts` runs this
// in a node process of its own and reads the one line of JSON it prints. Not a test itself.
//
// Why a process of its own: in one that has also run the real engine, every call site the hook makes into the engine,
// the controller and the body has met two kinds of object, and a call that is no longer monomorphic is not inlined
// and boxes the numbers it hands over (measured: 16 to 50 B a frame of the stubs' own calls, which the game, whose
// engine calls are always the engine's, never pays). Here the hook only ever meets the kept answers, so what the
// young generation grows by over a frame is the hook's own: the sway, both reels, the haul and its lip-over, the
// drags, the constraint and its correction, the collider sync, the clip and the wall it finds, the carry, the wrap's
// sweep and fan, the bend made at the lip, the anchor's check, and the mark shown and held. It never touches the
// real engine's world, but Rapier is loaded for the kept ray, triangle and contact record the hook makes once.
//
// Run: node --expose-gc tools/swg/tests/grappleAllocOwn.ts
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { GRAPPLE_TUNE, Grapple, type GrappleBody } from '../../../src/player/grapple.ts';
import { Group, RAPIER, type Physics } from '../../../src/core/physics.ts';

const gc = (globalThis as { gc?: (o?: { type: 'minor' }) => void }).gc;
if (!gc) {
  console.log(JSON.stringify({ skipped: 'run with node --expose-gc' }));
  process.exit(0);
}

// The building the scene hangs off, worked out by hand: a box from (-10, 0, -10) to (0, 20, 10), its lip along z at
// x 0, y 20. Every ray the hook casts is answered by the slab test against it, into one kept answer.
const B0x = -10;
const B0y = 0;
const B0z = -10;
const B1x = 0;
const B1y = 20;
const B1z = 10;
const stubCol = {
  handle: 77,
  isValid: () => true,
  parent: () => null,
  collisionGroups: () => (Group.exterior << 16) | Group.all,
  setTranslation: (_t: { x: number; y: number; z: number }) => {},
};
const answer = { timeOfImpact: 0, normal: { x: 0, y: 0, z: 0 }, collider: stubCol };
const boxCast = (r: { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } }, maxToi: number): typeof answer | null => {
  const ox = r.origin.x;
  const oy = r.origin.y;
  const oz = r.origin.z;
  const dx = r.dir.x;
  const dy = r.dir.y;
  const dz = r.dir.z;
  let tmin = 0;
  let tmax = maxToi;
  let nx = 0;
  let ny = 1;
  let nz = 0;
  if (dx > -1e-12 && dx < 1e-12) {
    if (ox < B0x || ox > B1x) return null;
  } else {
    const ta = (B0x - ox) / dx;
    const tb = (B1x - ox) / dx;
    const t1 = ta < tb ? ta : tb;
    const t2 = ta < tb ? tb : ta;
    if (t1 > tmin) {
      tmin = t1;
      nx = dx > 0 ? -1 : 1;
      ny = 0;
      nz = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (dy > -1e-12 && dy < 1e-12) {
    if (oy < B0y || oy > B1y) return null;
  } else {
    const ta = (B0y - oy) / dy;
    const tb = (B1y - oy) / dy;
    const t1 = ta < tb ? ta : tb;
    const t2 = ta < tb ? tb : ta;
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = dy > 0 ? -1 : 1;
      nz = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (dz > -1e-12 && dz < 1e-12) {
    if (oz < B0z || oz > B1z) return null;
  } else {
    const ta = (B0z - oz) / dz;
    const tb = (B1z - oz) / dz;
    const t1 = ta < tb ? ta : tb;
    const t2 = ta < tb ? tb : ta;
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = 0;
      nz = dz > 0 ? -1 : 1;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  answer.timeOfImpact = tmin;
  answer.normal.x = nx;
  answer.normal.y = ny;
  answer.normal.z = nz;
  return answer;
};
// After the setup a ray is answered by a rule small enough to be built into the call (`near`): a call into the stub that
// is not built in boxes the numbers handed to it, which is the boundary's cost and not the hook's (the engine's own,
// in the game, is what test 17's calibrations price). A ray from the street (east of the wall by more than the hand
// ever stands) toward the wall's face, near level, meets it half way along its reach; any other meets nothing, which
// is what every span of the rope under the lip and every line from the hand does.
const wall = { timeOfImpact: 0.5, normal: { x: 1, y: 0, z: 0 }, collider: stubCol };
const near = (r: { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } }, maxToi: number): typeof answer | null => {
  if (!(r.origin.x > 3 && r.dir.x < -0.5 && r.dir.y < 0.2 && r.dir.y > -0.2)) return null;
  wall.timeOfImpact = maxToi * 0.5;
  return wall;
};
let exact = true;
const stubWorld = {
  castRayAndGetNormal: (r: { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } }, maxToi: number) => (exact ? boxCast(r, maxToi) : near(r, maxToi)),
  intersectionWithShape: () => null,
};
const no = (_h: number): boolean => false;
const physics = { world: stubWorld, isPane: no, isRagdoll: no, isWalkThrough: no, isPeer: no, isWall: no, broken: false } as unknown as Physics;
const contactAnswer = { normal1: { x: 1, y: 0, z: 0 }, collider: stubCol };
let frame = 0;
const controller = {
  numComputedCollisions: () => ((frame & 3) === 0 ? 1 : 0),
  computedCollision: (_i: number, _out: unknown) => contactAnswer,
};
const body: GrappleBody = {
  pos: { x: -0.6, y: 20, z: 0 },
  vel: { x: 0, y: 0, z: 0 },
  grounded: false,
  swimming: false,
  depth: Number.NEGATIVE_INFINITY,
  inside: false,
  physics,
  body: null as unknown as RAPIER.RigidBody,
  collider: stubCol as unknown as RAPIER.Collider,
  controller: controller as unknown as RAPIER.KinematicCharacterController,
  colliderOffsetY: 0.8,
  filter: 0x7fff7fff,
  jka: { holdApex: (_y: number) => {} },
};
const g = new Grapple(RAPIER, physics);
const DT = 1 / 60;
const pos = body.pos;
const vel = body.vel;
const keys = g.keys;

// Fastened 4 m back on the roof, then let down over the lip a frame at a time: the bend at the lip is made by the
// hook's own sweep against the box, as a walk off a roof makes it.
g.attachNow(body, -4, 20, 0, 0, 1, 0, stubCol as unknown as RAPIER.Collider, 12);
for (let i = 0; i <= 120; i++) {
  // Out over the lip at the roof's height, then down the wall's face.
  const t = i / 120;
  pos.x = t < 0.5 ? -0.6 + 2.1 * t : 0.45;
  pos.y = t < 0.5 ? 20 : 20 - 2.7 * (2 * t - 1);
  g.refreshModes(body);
  g.beforeMove(body, DT);
  g.afterMove(body, DT);
}
exact = false;
const bentAtLip = g.rope.n === 1 && Math.abs(g.rope.contact[3] - 0) < 1e-3 && Math.abs(g.rope.contact[4] - 20) < 1e-3;
g.rope.length = g.rope.spent + 2;

// The mark's view, written as the game's `stepGrappleMark` writes it, from kept records.
const eye = { x: 6, y: 18, z: 0 };
const look = { x: -1, y: 0, z: 0 };
const orbit = { d: 0 };
const at = { x: 0, y: 0, z: 0 };
const mv = g.view;
const noWater = (_p: { x: number; y: number; z: number }): boolean => false;
const seen = { sway: 0, reelIn: 0, reelOut: 0, haul: 0, lip: 0, wall: 0, taut: 0, shows: 0, held: 0 };
const step = (counting: boolean) => {
  // The hand round a loop under the lip, never past it (the bend there holds) and never more than a few centimetres a
  // frame; the keys change every 128 frames: sway two ways, reel in, reel out, haul; and the view turns off the wall
  // to the sky for a share of every 64 frames, so the mark is lost and held.
  const a = frame * 0.05;
  const phase = (frame >> 7) % 6;
  frame++;
  pos.x = 0.45 + 0.1 * Math.sin(a);
  pos.y = 18.6 + 0.9 * Math.sin(0.7 * a) - GRAPPLE_TUNE.ropeY;
  pos.z = 0.4 * Math.sin(1.3 * a);
  vel.x = 0.5 * Math.cos(a);
  vel.y = -1 + Math.sin(0.3 * a);
  vel.z = 0.2;
  g.refreshModes(body);
  keys.swayX = phase < 2 ? (phase === 0 ? 0 : -1) : 0;
  keys.swayZ = phase === 0 ? 1 : 0;
  keys.reelIn = phase === 2;
  keys.reelOut = phase === 3;
  keys.haul = phase >= 4;
  g.beforeMove(body, DT);
  g.syncCollider(body);
  g.clip(body);
  g.afterMove(body, DT);
  at.x = pos.x;
  at.y = pos.y + GRAPPLE_TUNE.ropeY;
  at.z = pos.z;
  look.y = (frame & 63) < 40 ? 0 : 0.9;
  mv.eyeX = eye.x;
  mv.eyeY = eye.y;
  mv.eyeZ = eye.z;
  mv.dirX = look.x;
  mv.dirY = look.y;
  mv.dirZ = look.z;
  mv.orbit = orbit.d;
  mv.hand = at;
  mv.filter = body.filter;
  mv.exclude = null;
  g.probeMark(physics, noWater, DT);
  if (counting) {
    if (keys.swayX !== 0 || keys.swayZ !== 0) seen.sway++;
    if (keys.reelIn) seen.reelIn++;
    if (keys.reelOut) seen.reelOut++;
    if (g.hauling) seen.haul++;
    if (g.lipping) seen.lip++;
    if (g.lastImpact > 0) seen.wall++;
    if (g.taut) seen.taut++;
    if (g.mark.shows && !g.mark.held) seen.shows++;
    if (g.mark.held) seen.held++;
  }
};
for (let k = 0; k < 6 * 128; k++) step(true);

// The young generation over the frames, the cleanest of three tries. Each try starts from a full collection, then
// warms again what it may have thrown away, then empties the young generation with a minor one (which throws no
// code away), and reads the collections only after two turns of the loop, which is when the observer is told.
let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => {
  await tick();
  await tick();
};
const FRAMES = 200_000;
for (let k = 0; k < 100_000; k++) step(false);
let best = { made: Infinity, scavenges: Infinity };
for (let attempt = 0; attempt < 3; attempt++) {
  gc();
  await settle();
  for (let k = 0; k < 50_000; k++) step(false);
  gc({ type: 'minor' });
  await settle();
  scavenges = 0;
  const before = young();
  for (let k = 0; k < FRAMES; k++) step(false);
  const made = young() - before;
  await settle();
  if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
  if (best.scavenges === 0 && best.made <= 0) break;
}
watch.disconnect();
console.log(JSON.stringify({ frames: FRAMES, made: best.made, scavenges: best.scavenges, seen, bentAtLip, attached: g.attached, bends: g.rope.n }));
