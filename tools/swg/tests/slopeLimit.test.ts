// Wave 2b of the animations, item E: the slope limit (the owner's brief's line 11, and his note of 2026-11-15: "sliding
// never happens. I'm always just anchored to the ground"), on the real Rapier with the player's own movement (the
// grapple's harness, `grappleBody.ts`, which steps the very calls `Player.update` steps and which `grappleWiring.test.ts`
// and this file hold to the player's lines).
//
// The measurement first: a body stood on, walked onto and dropped onto faces of 30, 50, 58, 65, 75 and 89 degrees, a
// terrain heightfield and a placed model's trimesh alike, under the rule before (held on every one) and the rule now
// (slides past the limit, every frame identical to before under it); the slide's speed by the world's gravity at 30,
// 60 and 144 frames a second at two shares of it; a jump off a steep face refused and allowed; the fall a slide ends in
// paid for its speed alone; a wedge between two steep faces held; the falling loop and no hop for a slide. Then
// everything under the limit identical to the rule before, frame for frame by `Object.is`, at three frame rates: flat
// ground, stairs and the autostep, a 40 degree ramp, a jump and its landing, a roll, a fall's harm, the grapple's hang and
// haul, and swimming. Day one: the harness at 'before' against 7424bad's own harness (loaded out of git, with a recorded
// digest for when git cannot answer), every face included. Mutations of the new code, each shown to fail its check. The
// fighters' own controller copy, measured and reported (left as it is).
//
// The review round's two (2026-11-15): a body still perched on a steep ridge, because where the fan met no face the
// controller's word stood, and a ridge has no face near the sphere, only its edge. So an edge is now judged by the faces
// that meet at it (`edgeProbe`): peaks of 65, 80 and 89 degrees, a model's and the terrain's, on and off their very top,
// slide; a lip, whose top is walkable, stands frame for frame as before; a low ridge with ground at its foot slides off it.
// And the rule cast its floor ray on every frame a body stood or walked (about 800 bytes each, the engine's): a stand is
// now kept while the body stays on the plane the ray found, or does not move, which changes no verdict (held to a rule
// that asks afresh every frame, frame for frame), and `slopeAlloc.test.ts` measures what is left.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as harness from './grappleBody.ts';
import { Group, RAPIER, TRIMESH_FLAGS, cleanTrimesh, groups, type Physics } from '../../../src/core/physics.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';
import { CLIMB_TUNE } from '../../../src/anim/climbTune.ts';
import { FIGHTER_BODY, applyBody, fallSpeed, settleFooting } from '../../../src/world/fighterStance.ts';
import { edgeGround, PLANE_REACH, slopeGround, SlopeRule } from '../../../src/player/slopeRule.ts';
import { BodyAnim } from '../../../src/anim/bodyAnim.ts';
import { ANIM_TUNE_SHIPPED, type AnimTune } from '../../../src/anim/animTune.ts';
import { MX } from '../../../src/anim/animRules.ts';
import { oldTexts, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const text = (rel: string) => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');
const { THREE, makePhysics, heightChunk, ground, box } = harness;

/** The commit wave 2b was built on (the polish round), whose own harness the day-one trace is held to. */
const BEFORE_2B = '7424bad';
/** The digest of the 'before' traces, recorded from 7424bad's own harness: what a checkout with no history is held to. */
const BEFORE_TRACE = 'dca7e6659d19254d';

type Harness = typeof harness;
type Body = InstanceType<Harness['TestBody']>;
const ANGLES = [30, 50, 58, 65, 75, 89] as const;
const STEEP = [58, 65, 75, 89] as const;
const X0 = 32;
const R = 0.35;
const rule = (r: 'limit' | 'before') => {
  LOCO_TUNE.slopeRule = r;
};
const shipped = { rule: LOCO_TUNE.slopeRule, jump: LOCO_TUNE.slopeJump, slope: { ...LOCO_TUNE.slope } };
const restore = () => {
  LOCO_TUNE.slopeRule = shipped.rule;
  LOCO_TUNE.slopeJump = shipped.jump;
  Object.assign(LOCO_TUNE.slope, shipped.slope);
};

// ---- the scenes -------------------------------------------------------------------------------------------------------

/** A face rising toward +x from x = 32 at `deg`: a terrain chunk the game's way, or a placed model's wedge over flat ground. */
function face(p: Physics, kind: 'terrain' | 'trimesh', deg: number): void {
  const t = Math.tan((deg * Math.PI) / 180);
  if (kind === 'terrain') {
    heightChunk(p, 0, -32, (x) => (x <= X0 ? 0 : (x - X0) * t));
    return;
  }
  ground(p, 0);
  const H = 30;
  const L = H / t;
  const W = 10;
  const v = new Float32Array([X0, 0, -W, X0 + L, 0, -W, X0 + L, H, -W, X0, 0, W, X0 + L, 0, W, X0 + L, H, W]);
  const idx = new Uint32Array([0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3, 0, 2, 1, 3, 4, 5]);
  const clean = cleanTrimesh(v, idx)!;
  const desc = RAPIER.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS).setFriction(0.8);
  desc.setCollisionGroups(groups(Group.exterior, Group.all));
  p.world.createCollider(desc);
}
/** A point on the face `h` up, and the face's normal. */
function faceAt(deg: number, h: number): { p: THREE.Vector3; n: THREE.Vector3 } {
  const a = (deg * Math.PI) / 180;
  return { p: new THREE.Vector3(X0 + h / Math.tan(a), h, 0), n: new THREE.Vector3(-Math.sin(a), Math.cos(a), 0) };
}

/** A body in a world the scene built, facing +x. */
async function bodyIn(H: Harness, build: (p: Physics) => void): Promise<{ b: Body; p: Physics }> {
  const p = await H.makePhysics();
  build(p);
  p.stepOnce();
  const b = new H.TestBody(p) as Body;
  b.forward.set(1, 0, 0);
  b.right.set(0, 0, 1);
  return { b, p };
}

/** A frame's trace: place, speed, the ground word, the fall's harm so far. */
function trace(b: Body, out: number[]): void {
  out.push(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.grounded ? 1 : 0, b.fallDamage);
}
/** Keys held over time: [seconds from, seconds to, key]. */
type Keys = readonly (readonly [number, number, string])[];
function runKeys(b: Body, fps: number, seconds: number, keys: Keys, out: number[]): void {
  const dt = 1 / fps;
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    for (const [from, to, code] of keys) {
      if (Math.abs(t - from) < dt / 2) b.key(code, true);
      if (Math.abs(t - to) < dt / 2) b.key(code, false);
    }
    b.frame(dt);
    trace(b, out);
  }
}

/**
 * How far down a body slides on a terrain face of `deg` in the second third of a second after it is stood on it (in
 * contact, at rest), under the rule now: the place's own measure, which the snap to the ground would drag.
 */
async function descent(H: Harness, fps: number, deg: number): Promise<number> {
  rule('limit');
  const { b, p } = await bodyIn(H, (pp) => face(pp, 'terrain', deg));
  const { p: at, n } = faceAt(deg, 25);
  const c = at.clone().addScaledVector(n, R + 0.04);
  b.place(c.x, c.y - R, c.z);
  b.run(fps, 1 / 3);
  const y1 = b.pos.y;
  b.run(fps, 1 / 3);
  p.world.free();
  return y1 - b.pos.y;
}

/** Every scene: its name and how it runs a body of a harness at a frame rate into a trace. */
interface Scene { name: string; under: boolean; run(H: Harness, fps: number): Promise<number[]> }
const scenes: Scene[] = [];

for (const kind of ['terrain', 'trimesh'] as const) {
  for (const deg of ANGLES) {
    const under = deg < 55;
    scenes.push({
      name: `stand ${kind} ${deg}`,
      under,
      async run(H, fps) {
        const { b, p } = await bodyIn(H, (pp) => face(pp, kind, deg));
        const { p: at, n } = faceAt(deg, 10);
        const c = at.clone().addScaledVector(n, R + 0.06);
        b.place(c.x, c.y - R, c.z);
        const out: number[] = [];
        runKeys(b, fps, 1.5, [], out);
        p.world.free();
        return out;
      },
    });
    scenes.push({
      name: `walk ${kind} ${deg}`,
      under,
      async run(H, fps) {
        const { b, p } = await bodyIn(H, (pp) => face(pp, kind, deg));
        b.place(X0 - 4, 0.02, 0);
        const out: number[] = [];
        runKeys(b, fps, 4, [[0.3, 3.3, 'KeyW']], out);
        p.world.free();
        return out;
      },
    });
    scenes.push({
      name: `land ${kind} ${deg}`,
      under,
      async run(H, fps) {
        const { b, p } = await bodyIn(H, (pp) => face(pp, kind, deg));
        const { p: at, n } = faceAt(deg, 10);
        const c = at.clone().addScaledVector(n, 1.2).add(new THREE.Vector3(0, 1.5, 0));
        b.place(c.x, c.y - R, c.z);
        b.vel.set(3, 0, 0);
        const out: number[] = [];
        runKeys(b, fps, 2, [], out);
        p.world.free();
        return out;
      },
    });
  }
}
// Under the limit, the rest of what the feet do.
scenes.push({
  name: 'flat ground: walk, back, strafe, Shift',
  under: true,
  async run(H, fps) {
    const { b, p } = await bodyIn(H, (pp) => ground(pp, 0));
    b.place(0, 0.02, 0);
    const out: number[] = [];
    runKeys(b, fps, 3, [[0.1, 1.2, 'KeyW'], [1.2, 1.8, 'KeyS'], [1.8, 2.4, 'KeyA'], [2.0, 2.6, 'ShiftLeft'], [2.4, 2.9, 'KeyD']], out);
    p.world.free();
    return out;
  },
});
scenes.push({
  name: 'stairs up and down (the autostep)',
  under: true,
  async run(H, fps) {
    const { b, p } = await bodyIn(H, (pp) => {
      ground(pp, 0);
      for (let i = 0; i < 6; i++) box(pp, [3 + i * 0.6, 0, -2], [3 + (i + 1) * 0.6, (i + 1) * 0.25, 2]);
      box(pp, [6.6, 0, -2], [8.6, 1.5, 2]);
      for (let i = 0; i < 6; i++) box(pp, [8.6 + i * 0.6, 0, -2], [8.6 + (i + 1) * 0.6, 1.5 - (i + 1) * 0.25, 2]);
    });
    b.place(1, 0.02, 0);
    const out: number[] = [];
    runKeys(b, fps, 5, [[0.1, 4.5, 'KeyW']], out);
    p.world.free();
    return out;
  },
});
scenes.push({
  name: 'a 40 degree ramp walked up and back down',
  under: true,
  async run(H, fps) {
    const { b, p } = await bodyIn(H, (pp) => face(pp, 'terrain', 40));
    b.place(X0 - 3, 0.02, 0);
    const out: number[] = [];
    runKeys(b, fps, 4.5, [[0.1, 2.5, 'KeyW'], [2.6, 4.4, 'KeyS']], out);
    p.world.free();
    return out;
  },
});
scenes.push({
  name: 'a jump on flat ground and its landing',
  under: true,
  async run(H, fps) {
    const { b, p } = await bodyIn(H, (pp) => ground(pp, 0));
    b.place(0, 0.02, 0);
    const out: number[] = [];
    runKeys(b, fps, 2.5, [[0.2, 2.0, 'KeyW'], [0.4, 0.6, 'Space']], out);
    p.world.free();
    return out;
  },
});
scenes.push({
  name: 'a roll (a crouch tapped on the move)',
  under: true,
  async run(H, fps) {
    const { b, p } = await bodyIn(H, (pp) => ground(pp, 0));
    b.place(0, 0.02, 0);
    const out: number[] = [];
    runKeys(b, fps, 2, [[0.1, 1.9, 'KeyW'], [0.6, 0.65, 'ControlLeft']], out);
    p.world.free();
    return out;
  },
});
scenes.push({
  name: "a fall's harm onto flat ground from 14 m",
  under: true,
  async run(H, fps) {
    const { b, p } = await bodyIn(H, (pp) => ground(pp, 0));
    b.place(0, 14, 0);
    const out: number[] = [];
    runKeys(b, fps, 2.5, [], out);
    p.world.free();
    return out;
  },
});
scenes.push({
  name: "the grapple's hang and haul up a 75 degree face",
  under: true,
  async run(H, fps) {
    let col: RAPIER.Collider | null = null;
    const { b, p } = await bodyIn(H, (pp) => {
      ground(pp, 0);
      col = box(pp, [X0 + 2, 0, -3], [X0 + 4, 12, 3]);
      face(pp, 'trimesh', 75);
    });
    b.place(X0 - 1.5, 0.02, 0);
    b.hook(X0 + 2, 12, 0, 0, 1, 0, col);
    const out: number[] = [];
    runKeys(b, fps, 4, [[0.8, 3.8, 'KeyF']], out);
    p.world.free();
    return out;
  },
});
scenes.push({
  name: 'swimming',
  under: true,
  async run(H, fps) {
    const { b, p } = await bodyIn(H, (pp) => ground(pp, -3));
    b.surface = () => 0;
    b.place(0, -1.4, 0);
    const out: number[] = [];
    runKeys(b, fps, 2, [[0.1, 1.5, 'KeyW']], out);
    p.world.free();
    return out;
  },
});

/** A body dropped into a V of two 70 degree faces, run three seconds: whether it rests there, ground, gathering no fall. */
async function vee(H: Harness): Promise<{ rests: boolean; y: number; grounded: boolean; vy: number }> {
  const { b, p } = await bodyIn(H, (pp) => {
    ground(pp, -20);
    const mk = (sign: number) => {
      const t = Math.tan((70 * Math.PI) / 180);
      const v = new Float32Array([0, 0, -5, sign * 10 / t, 10, -5, 0, 0, 5, sign * 10 / t, 10, 5]);
      const idx = sign > 0 ? new Uint32Array([0, 2, 3, 0, 3, 1]) : new Uint32Array([0, 1, 3, 0, 3, 2]);
      const desc = RAPIER.ColliderDesc.trimesh(v, idx, TRIMESH_FLAGS);
      desc.setCollisionGroups(groups(Group.exterior, Group.all));
      pp.world.createCollider(desc);
    };
    mk(1);
    mk(-1);
  });
  b.place(0, 3, 0);
  b.run(60, 2);
  const y1 = b.pos.y;
  b.run(60, 1);
  const out = { rests: Math.abs(b.pos.y - y1) < 0.01 && b.vel.y > -0.5 && b.grounded, y: b.pos.y, grounded: b.grounded, vy: b.vel.y };
  p.world.free();
  return out;
}

// ---- edges: a ridge (two steep faces meeting at a peak), a lip (a walkable top falling away steeply) -----------------------
const PEAK = 20;
/** A ridge along z at x = 20, `top` high, its two faces at `deg`: a placed model's trimesh over flat ground, or a terrain chunk. */
function ridge(p: Physics, kind: 'terrain' | 'trimesh', deg: number, top = 10): void {
  const t = Math.tan((deg * Math.PI) / 180);
  ground(p, 0);
  if (kind === 'terrain') {
    heightChunk(p, 0, -32, (x) => Math.max(0, top - Math.abs(x - PEAK) * t));
    return;
  }
  const L = top / t;
  const W = 6;
  const v = new Float32Array([PEAK - L, 0, -W, PEAK, top, -W, PEAK + L, 0, -W, PEAK - L, 0, W, PEAK, top, W, PEAK + L, 0, W]);
  const idx = new Uint32Array([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 0, 3, 5, 0, 5, 2]);
  const clean = cleanTrimesh(v, idx)!;
  const desc = RAPIER.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS).setFriction(0.8);
  desc.setCollisionGroups(groups(Group.exterior, Group.all));
  p.world.createCollider(desc);
}
const LIP = 30;
const LIP_TOP = 10;
/** A walkable top 10 m up for x < 30, falling from its lip at `deg` to flat ground: a terrain chunk, or a model's block. */
function lip(p: Physics, kind: 'terrain' | 'trimesh', deg: number): void {
  const t = Math.tan((deg * Math.PI) / 180);
  if (kind === 'terrain') {
    heightChunk(p, 0, -32, (x) => (x <= LIP ? LIP_TOP : Math.max(0, LIP_TOP - (x - LIP) * t)));
    return;
  }
  ground(p, 0);
  const L = LIP_TOP / t;
  const W = 10;
  const v = new Float32Array([0, LIP_TOP, -W, LIP, LIP_TOP, -W, LIP + L, 0, -W, 0, 0, -W, 0, LIP_TOP, W, LIP, LIP_TOP, W, LIP + L, 0, W, 0, 0, W]);
  const idx = new Uint32Array([0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 3, 7, 4, 3, 4, 0, 0, 1, 2, 0, 2, 3, 4, 7, 6, 4, 6, 5]);
  const clean = cleanTrimesh(v, idx)!;
  const desc = RAPIER.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS).setFriction(0.8);
  desc.setCollisionGroups(groups(Group.exterior, Group.all));
  p.world.createCollider(desc);
}
/** A body dropped from a metre over a ridge's peak, `off` to one side of it, for four seconds: its trace. */
async function onPeak(H: Harness, kind: 'terrain' | 'trimesh', deg: number, off: number, fps: number, top = 10): Promise<number[]> {
  const { b, p } = await bodyIn(H, (pp) => ridge(pp, kind, deg, top));
  b.place(PEAK + off, top + 1, 0);
  const out: number[] = [];
  runKeys(b, fps, 4, [], out);
  p.world.free();
  return out;
}
/** A body walked off a lip onto its steep face, W held for 0.7 s (just over it) and then let go: its trace. */
async function offLip(H: Harness, kind: 'terrain' | 'trimesh', deg: number, fps: number): Promise<number[]> {
  const { b, p } = await bodyIn(H, (pp) => lip(pp, kind, deg));
  b.place(LIP - 4, LIP_TOP + 0.02, 0);
  const out: number[] = [];
  runKeys(b, fps, 4, [[0, 0.7, 'KeyW']], out);
  p.world.free();
  return out;
}
/** A body stood `dx` past a lip, for two seconds: its trace. */
async function atLip(H: Harness, kind: 'terrain' | 'trimesh', deg: number, dx: number): Promise<number[]> {
  const { b, p } = await bodyIn(H, (pp) => lip(pp, kind, deg));
  b.place(LIP + dx, LIP_TOP + 0.3, 0);
  const out: number[] = [];
  runKeys(b, 60, 2, [], out);
  p.world.free();
  return out;
}
/** A body stood on a steep face `h` up, sliding to the floor at its foot for four seconds: how high it ends. */
async function slideToFloor(H: Harness, kind: 'terrain' | 'trimesh', deg: number, h: number, fps: number): Promise<number> {
  const { b, p } = await bodyIn(H, (pp) => face(pp, kind, deg));
  const { p: at, n } = faceAt(deg, h);
  const c = at.clone().addScaledVector(n, R + 0.04);
  b.place(c.x, c.y - R, 0.3);
  b.run(fps, 4);
  p.world.free();
  return b.pos.y;
}
/** Whether a trace is ever ground with the body up on a face, between `lo` and `hi` metres up. */
const groundedBetween = (t: number[], lo: number, hi: number): boolean => {
  for (let i = 0; i < t.length; i += 8) if (t[i + 6] === 1 && t[i + 1] > lo && t[i + 1] < hi) return true;
  return false;
};
const endY = (t: number[]) => t[t.length - 7];

const same = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const firstDiff = (a: number[], b: number[]): string => {
  const i = a.findIndex((v, k) => !Object.is(v, b[k]));
  return i < 0 ? (a.length === b.length ? 'none' : `lengths ${a.length} and ${b.length}`) : `frame ${Math.floor(i / 8)} field ${i % 8}: ${a[i]} against ${b[i]}`;
};

// ---- the measurement: before held, now slid past the limit ---------------------------------------------------------------
{
  // Wave 4, item B: W held into a face past the limit now climbs it (its own suite's, wallClimb.test.ts); what is measured
  // here is the walk, so the climb is held at 'before' through it.
  CLIMB_TUNE.wall = 'before';
  const T = (s: number[], frame: number, f: number) => s[frame * 8 + f];
  for (const kind of ['terrain', 'trimesh'] as const) {
    const rows: string[] = [];
    for (const deg of ANGLES) {
      const stand = scenes.find((s) => s.name === `stand ${kind} ${deg}`)!;
      const land = scenes.find((s) => s.name === `land ${kind} ${deg}`)!;
      const walk = scenes.find((s) => s.name === `walk ${kind} ${deg}`)!;
      rule('before');
      const sb = await stand.run(harness, 60);
      const lb = await land.run(harness, 60);
      const wb = await walk.run(harness, 60);
      rule('limit');
      const sl = await stand.run(harness, 60);
      const ll = await land.run(harness, 60);
      const wl = await walk.run(harness, 60);
      const frames = sb.length / 8;
      const dropB = T(sb, 0, 1) - T(sb, frames - 1, 1);
      const dropL = T(sl, 0, 1) - T(sl, frames - 1, 1);
      const groundedB = Array.from({ length: frames }, (_, i) => T(sb, i, 6)).every((g) => g === 1);
      // The body is never ground on the face while it is up on it: only within the floor ray's reach of the flat floor at
      // its foot (the sphere's 0.35 and 0.4 under the sphere's middle), where the snap then puts it down.
      const groundedOnFace = Array.from({ length: frames }, (_, i) => i).some((i) => T(sl, i, 6) === 1 && T(sl, i, 1) > 0.45);
      const topB = Math.max(...Array.from({ length: wb.length / 8 }, (_, i) => T(wb, i, 1)));
      const topL = Math.max(...Array.from({ length: wl.length / 8 }, (_, i) => T(wl, i, 1)));
      // Landed: how far the body went down over the last second (before), and where it ends (now).
      const lf = ll.length / 8;
      const lbDrop = T(lb, Math.min(lf - 1, 30 + 60), 1) - T(lb, lf - 1, 1);
      rows.push(`${deg}: stand before drop ${dropB.toFixed(3)} m grounded ${groundedB ? 'every frame' : 'not always'} | now drop ${dropL.toFixed(2)} m; walked up before ${topB.toFixed(2)} m, now ${topL.toFixed(2)} m; landed before, last second's drop ${lbDrop.toFixed(3)} m`);
      if (deg < 55) {
        ok(same(sb, sl) && same(lb, ll) && same(wb, wl), `${kind} ${deg} degrees, under the limit: standing, walking up and landing are frame for frame the rule before's (${firstDiff(sb, sl)}; ${firstDiff(wb, wl)}; ${firstDiff(lb, ll)})`);
        ok(dropB < 0.01 && topB > 3, `${kind} ${deg} degrees: stood on and walked up, as ever (up ${topB.toFixed(2)} m)`);
      } else {
        ok(groundedB && dropB < 0.01, `${kind} ${deg} degrees, before: the body stood held on the face (dropped ${dropB.toFixed(4)} m in 1.5 s, the controller calling it ground every frame): the fault`);
        ok(dropL > 5 && !groundedOnFace, `${kind} ${deg} degrees, now: it slides off (down ${dropL.toFixed(2)} m in 1.5 s) and is never ground while up on the face`);
        ok(topB < 0.1 && topL < 0.1, `${kind} ${deg} degrees: never walked up, before or now (${topB.toFixed(2)}, ${topL.toFixed(2)} m)`);
        ok(lbDrop < 0.02, `${kind} ${deg} degrees, before: a body jumping onto it held where it landed`);
        const end = T(ll, lf - 1, 1);
        ok(end < 0.2, `${kind} ${deg} degrees, now: a body jumping onto it slides to its foot (${end.toFixed(2)} m up at the end, from 10)`);
      }
    }
    for (const r of rows) note(`${kind} ${r}`);
  }
  CLIMB_TUNE.wall = 'on';
}

// ---- the slide: the world's gravity times the share, the same at every frame rate -----------------------------------------
{
  const g = new harness.TestBody(await makePhysics()).jka.gravity;
  for (const share of [1, 0.5]) {
    for (const deg of [58, 75, 89]) {
      const got: string[] = [];
      for (const fps of [30, 60, 144]) {
        rule('limit');
        LOCO_TUNE.slope.slide = share;
        const { b, p } = await bodyIn(harness, (pp) => face(pp, 'terrain', deg));
        const { p: at, n } = faceAt(deg, 25);
        const c = at.clone().addScaledVector(n, R + 0.04);
        b.place(c.x, c.y - R, c.z);
        b.run(fps, 1 / 3);
        const v1 = b.vel.length();
        const s1 = b.slope.sliding;
        b.run(fps, 1 / 3);
        const v2 = b.vel.length();
        p.world.free();
        const want = (share * g * Math.sin((deg * Math.PI) / 180)) / 3;
        got.push(`${fps}: ${(v2 - v1).toFixed(3)}`);
        ok(s1 && b.slope.sliding && Math.abs(v2 - v1 - want) < want * 0.01, `${deg} degrees at ${fps} frames a second, slide share ${share}: its speed down the face grows by g·share·sin over a third of a second (whole frames at all three rates) (${(v2 - v1).toFixed(3)} against ${want.toFixed(3)} m/s)`);
      }
      note(`speed gained in a third of a second sliding, ${deg} degrees, share ${share}: ${got.join(', ')}`);
    }
  }
  restore();
  // And the way travelled: the same at every frame rate to within what one frame's step of the movement's own
  // integration makes (the speed is exact above; the place is the speed's sum, a frame late or early).
  for (const deg of [58, 75, 89]) {
    const a30 = await descent(harness, 30, deg);
    const a60 = await descent(harness, 60, deg);
    const a144 = await descent(harness, 144, deg);
    const g = 20.32;
    const a = g * Math.sin((deg * Math.PI) / 180) ** 2;
    // From a speed already a third of a second old, a third of a second more: (v0 + a t / 2) t, straight down.
    const want = a * (1 / 3) * (1 / 3) + (a * (1 / 3) * (1 / 3)) / 2;
    ok([a30, a60, a144].every((x) => Math.abs(x - want) < want * 0.06), `${deg} degrees: the way slid down in the second third of a second is ${a30.toFixed(3)}, ${a60.toFixed(3)} and ${a144.toFixed(3)} m at 30, 60 and 144 frames a second, against ${want.toFixed(3)} for a slide with no friction`);
  }
}

// ---- the jump off a steep face: refused, and allowed by the switch ----------------------------------------------------------
{
  for (const how of ['refused', 'allowed'] as const) {
    rule('limit');
    LOCO_TUNE.slopeJump = how;
    const { b, p } = await bodyIn(harness, (pp) => face(pp, 'terrain', 70));
    const { p: at, n } = faceAt(70, 20);
    const c = at.clone().addScaledVector(n, R + 0.04);
    b.place(c.x, c.y - R, c.z);
    b.run(60, 0.2);
    const sliding = b.slope.sliding;
    b.key('Space', true);
    b.frame(1 / 60);
    const vy = b.vel.y;
    b.key('Space', false);
    p.world.free();
    if (how === 'refused') ok(sliding && vy < 0 && b.jumped === 0, `slopeJump 'refused' (the start): Space pressed while sliding down a 70 degree face jumps nowhere (still falling at ${vy.toFixed(2)} m/s)`);
    else ok(sliding && vy > 0 && b.jumped === 1, `slopeJump 'allowed': the plain jump off it, as from the ground (rising at ${vy.toFixed(2)} m/s)`);
  }
  restore();
}

// ---- the fall a slide ends in: its speed into the ground alone ----------------------------------------------------------------
{
  const dmg = async (build: (p: Physics) => void, at: THREE.Vector3): Promise<number> => {
    rule('limit');
    const { b, p } = await bodyIn(harness, build);
    b.place(at.x, at.y - R, at.z);
    b.run(60, 6);
    p.world.free();
    return b.fallDamage;
  };
  const H = 16;
  const free = await dmg((p) => ground(p, 0), new THREE.Vector3(0, H + R, 0));
  const sheer = faceAt(89, H);
  const s89 = await dmg((p) => face(p, 'trimesh', 89), sheer.p.clone().addScaledVector(sheer.n, R + 0.04));
  const f58 = faceAt(58, H);
  const s58 = await dmg((p) => face(p, 'trimesh', 58), f58.p.clone().addScaledVector(f58.n, R + 0.04));
  note(`the harm of ${H} m: a free fall ${free}, down an 89 degree face ${s89}, down a 58 degree face ${s58}`);
  ok(free > 0 && s89 > 0 && s89 <= free && s58 < s89, `a slide pays for its speed into the ground and no more: a free fall from ${H} m costs ${free}, a slide down an 89 degree face ${s89} (nearly the fall), down a 58 degree face ${s58} (less: its speed into the ground is the share of it straight down)`);
  restore();
}

// ---- a wedge between two steep faces holds the body; the pure verdict ---------------------------------------------------------
{
  const cos55 = Math.cos((55 * Math.PI) / 180);
  const ny70 = Math.cos((70 * Math.PI) / 180);
  const nx70 = Math.sin((70 * Math.PI) / 180);
  ok(slopeGround(1, [], [], [], 0, cos55) && slopeGround(Number.NaN, [], [], [], 0, cos55), 'the verdict: a walkable face under the body is ground, and nothing met at all leaves the controller its word (an edge, which no ray meets as a face)');
  ok(!slopeGround(Number.NaN, [-nx70], [ny70], [0], 1, cos55) && slopeGround(Number.NaN, [-nx70, 0], [ny70, 1], [0, 0], 2, cos55), 'one 70 degree face alone is no ground; beside a walkable one it is ground');
  ok(slopeGround(Number.NaN, [-nx70, nx70], [ny70, ny70], [0, 0], 2, cos55) && !slopeGround(Number.NaN, [-nx70, -nx70 * 0.99], [ny70, ny70], [0, 0.14], 2, cos55), 'two 70 degree faces leaning together (a V) hold the body up; two leaning the same way do not');
  ok(edgeGround(true, true) && edgeGround(true, false) && !edgeGround(false, true) && edgeGround(false, false), "an edge's verdict: a walkable face at it is a lip and stands; steep faces only are a peak and do not; nothing met (sheer sides) leaves the controller its word");
  rule('limit');
  const v = await vee(harness);
  note(`a body dropped into a V of two 70 degree faces rests ${v.y.toFixed(2)} m up, grounded ${v.grounded}, falling at ${v.vy.toFixed(2)} m/s`);
  ok(v.rests, 'in the real world a body in that V rests, ground, and gathers no fall');
  restore();
}

// ---- an edge: a peak slides off, a lip stands as ever (the review round's first finding) -----------------------------------
{
  // A ridge: a model's and the terrain's, 65 and 80 degrees, dropped on its very top and 0.1 and 0.25 m off it.
  for (const kind of ['trimesh', 'terrain'] as const) {
    for (const deg of [65, 80]) {
      for (const off of [0, 0.1, 0.25]) {
        rule('before');
        const tb = await onPeak(harness, kind, deg, off, 60);
        rule('limit');
        const tl = await onPeak(harness, kind, deg, off, 60);
        ok(endY(tb) > 9.8 && endY(tl) < 1 && !groundedBetween(tl, 2, 9.8), `a ${kind} ridge of ${deg} degrees, dropped ${off} m off its peak: before, the body perched there (${endY(tb).toFixed(2)} m up, the review's case); now it slides off to the foot (${endY(tl).toFixed(2)} m up at the end) and is never ground on a face`);
      }
    }
  }
  // At every frame rate.
  for (const [kind, deg, off] of [['trimesh', 80, 0.1], ['terrain', 65, 0.25], ['terrain', 80, 0]] as const) {
    rule('limit');
    const ends: string[] = [];
    let all = true;
    for (const fps of [30, 144]) {
      const t = await onPeak(harness, kind, deg, off, fps);
      ends.push(`${fps}: ${endY(t).toFixed(2)}`);
      all &&= endY(t) < 1 && !groundedBetween(t, 2, 9.8);
    }
    ok(all, `and so at 30 and 144 frames a second, a ${kind} ridge of ${deg} degrees ${off} m off its peak (ends ${ends.join(', ')} m up)`);
  }
  // A knife edge: two faces of 89 degrees, a model's (a pointed wall's top).
  for (const off of [0.05, 0.1, 0.25]) {
    rule('before');
    const tb = await onPeak(harness, 'trimesh', 89, off, 60);
    rule('limit');
    const tl = await onPeak(harness, 'trimesh', 89, off, 60);
    ok(endY(tb) > 9.8 && endY(tl) < 1 && !groundedBetween(tl, 2, 9.8), `a knife edge of 89 degrees, dropped ${off} m off it: before, perched (${endY(tb).toFixed(2)} m); now it slides off (${endY(tl).toFixed(2)} m), never ground on a face`);
  }
  // A low ridge with flat ground at its foot: the ground beside it holds nothing up on its top.
  rule('before');
  const lb = await onPeak(harness, 'trimesh', 70, 0.25, 60, 0.5);
  rule('limit');
  const ll = await onPeak(harness, 'trimesh', 70, 0.25, 60, 0.5);
  ok(endY(lb) > 0.4 && endY(ll) < 0.1, `a ridge of 70 degrees only half a metre high, dropped 0.25 m off its peak: before, perched (${endY(lb).toFixed(2)} m); now it slides off onto the flat ground at its foot (${endY(ll).toFixed(2)} m)`);
  // A lip: stood up to 0.3 m past it, the body stands exactly as before (its top is walkable).
  for (const kind of ['terrain', 'trimesh'] as const) {
    for (const deg of [65, 80]) {
      const rows: string[] = [];
      let all = true;
      for (const dx of [-0.05, 0, 0.1, 0.2, 0.3]) {
        rule('before');
        const a = await atLip(harness, kind, deg, dx);
        rule('limit');
        const b2 = await atLip(harness, kind, deg, dx);
        rows.push(`${dx}: ${endY(b2).toFixed(2)}`);
        all &&= same(a, b2);
      }
      ok(all, `a ${kind} lip falling at ${deg} degrees, the body stood 0.05 m short of it to 0.3 m past it: frame for frame as before, standing (${rows.join(', ')} m)`);
    }
  }
  // Walked off a lip onto its steep face: before it perched on the face where W was let go; now it slides to the foot.
  for (const kind of ['terrain', 'trimesh'] as const) {
    for (const deg of [65, 80]) {
      rule('before');
      const tb = await offLip(harness, kind, deg, 60);
      const ends: string[] = [];
      let all = true;
      for (const fps of [30, 60, 144]) {
        rule('limit');
        const t = await offLip(harness, kind, deg, fps);
        ends.push(`${fps}: ${endY(t).toFixed(2)}`);
        all &&= endY(t) < 1 && !groundedBetween(t, 2, LIP_TOP - 0.5);
      }
      ok(endY(tb) > 7 && all, `a ${kind} lip falling at ${deg} degrees, walked off with W for 0.7 s: before, the body perched on the face (${endY(tb).toFixed(2)} m up); now it slides to the foot at every frame rate (${ends.join(', ')} m up), never ground on the face`);
    }
  }
  restore();
}

// ---- a slide ends on the floor, never hung over it (the floor ray's reach is past the snap's) ------------------------------
{
  rule('limit');
  const ends: number[] = [];
  for (const kind of ['terrain', 'trimesh'] as const) for (const deg of [75, 89]) for (const h of [6, 7.3, 8.1, 10.7]) for (const fps of [60, 144]) ends.push(await slideToFloor(harness, kind, deg, h, fps));
  const top = Math.max(...ends);
  ok(top < 0.08, `${ends.length} slides down faces of 75 and 89 degrees, a model's and the terrain's, from four heights at 60 and 144 frames a second, all end on the floor at their foot (the highest ${top.toFixed(3)} m up; under the rule before this round 4 of these hung 0.2 to 0.29 m over it, held by the steep face with the floor in the ray's reach)`);
  restore();
}

// ---- a verdict kept: the floor ray is not cast again while the body stays on its plane, or stands still ------------------------
{
  rule('limit');
  const { b, p } = await bodyIn(harness, (pp) => ground(pp, 0));
  b.place(0, 0.02, 0);
  b.run(60, 0.5);
  let c0 = b.slope.casts;
  b.run(60, 2);
  const standCasts = b.slope.casts - c0;
  const x0 = b.pos.x;
  c0 = b.slope.casts;
  const k0 = b.slope.kept;
  b.key('KeyW', true);
  b.run(60, 4);
  b.key('KeyW', false);
  const walked = b.pos.x - x0;
  const walkCasts = b.slope.casts - c0;
  const walkKept = b.slope.kept - k0;
  p.world.free();
  ok(standCasts === 0 && walkCasts <= Math.ceil(walked / PLANE_REACH) + 1 && walkKept >= 240 - walkCasts, `on flat ground: two seconds standing cast no ray at all, and four seconds walking (${walked.toFixed(1)} m) cast ${walkCasts}, one each ${PLANE_REACH} m at the most, the other ${walkKept} verdicts kept`);
  // Rolling terrain: how often the plane changes enough to ask again.
  const r = await bodyIn(harness, (pp) => heightChunk(pp, 0, -32, (x, z) => 3 + 2 * Math.sin(x / 7) * Math.cos(z / 9) + 0.5 * Math.sin(x / 3)));
  r.b.place(6, 8, 3);
  r.b.run(60, 1);
  const rx = r.b.pos.x;
  const rc = r.b.slope.casts;
  r.b.key('KeyW', true);
  r.b.run(60, 4);
  const rolled = r.b.pos.x - rx;
  note(`walking ${rolled.toFixed(1)} m over rolling terrain (2 m hills, the terrain's 2 m cells) cast ${r.b.slope.casts - rc} rays in 240 frames: ${((r.b.slope.casts - rc) / rolled).toFixed(2)} a metre, where the rule before this round cast one every frame`);
  r.p.world.free();
  restore();
}

// ---- under the limit: everything else the feet do is the rule before's, frame for frame ---------------------------------------
for (const s of scenes.filter((x) => x.under && !/^(stand|walk|land) /.test(x.name))) {
  for (const fps of [30, 60, 144]) {
    rule('before');
    const a = await s.run(harness, fps);
    rule('limit');
    const b2 = await s.run(harness, fps);
    ok(same(a, b2), `${s.name}, at ${fps} frames a second: the slope's rule is the rule before's to the bit (${a.length / 8} frames; ${firstDiff(a, b2)})`);
  }
}
restore();

// ---- day one: 'before' is 7424bad's own harness, every face included ----------------------------------------------------------
async function loadHarness(texts: Map<string, string>): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'slope-harness-'));
  const three = import.meta.resolve('three');
  const where = (f: string) => join(dir, f.replace(/\//g, '__'));
  try {
    for (const [f, src] of texts) {
      const from = resolve(REPO, f, '..');
      const point = (p: string): string => {
        const target = resolve(from, p).replace(/\\/g, '/');
        const own = [...texts.keys()].find((x) => resolve(REPO, x).replace(/\\/g, '/') === target);
        return own ? pathToFileURL(where(own)).href : pathToFileURL(resolve(from, p)).href;
      };
      const out = src
        .replace(/from 'three'/g, `from '${three}'`)
        .replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${point(p)}'`)
        .replace(/import\('(\.\.?\/[^']+)'\)/g, (_m, p: string) => `import('${point(p)}')`);
      writeFileSync(where(f), out);
    }
    return (await import(pathToFileURL(where('tools/swg/tests/grappleBody.ts')).href)) as Harness;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  const old = oldTexts(['tools/swg/tests/grappleBody.ts'], BEFORE_2B);
  const oldH = old ? await loadHarness(old) : null;
  const now: number[][] = [];
  rule('before');
  // Wave 4's ledges are a switch of their own, held to its own day one (wave4DayOne.test.ts): 'before' here, since the
  // harness this compares with had none (the haul up the face ends under a lip a hang now takes).
  CLIMB_TUNE.ledges = 'before';
  // (And the wall climb's, item B: these scenes press into faces the climb would take.)
  CLIMB_TUNE.wall = 'before';
  // (And Stairs II's step-up mend, a switch of its own held to its own day one (playerStepUp.test.ts): the stairs scene's autostep
  // is the very thing it mends.)
  LOCO_TUNE.step.rule = 'before';
  for (const s of scenes) {
    const a = await s.run(harness, 60);
    now.push(a);
    if (oldH) {
      const b2 = await s.run(oldH, 60);
      ok(same(a, b2), `day one, ${s.name}: the harness at 'before' is ${BEFORE_2B}'s own, frame for frame (${firstDiff(a, b2)})`);
    }
  }
  restore();
  CLIMB_TUNE.ledges = 'on';
  CLIMB_TUNE.wall = 'on';
  LOCO_TUNE.step.rule = 'mended';
  const digest = createHash('sha1').update(now.map((t) => t.join(',')).join('\n')).digest('hex').slice(0, 16);
  if (oldH) note(`the 'before' traces' digest is ${digest} (BEFORE_TRACE, which a checkout with no history is held to)`);
  else note(`git cannot hand over ${BEFORE_2B}'s harness here: the 'before' traces are held to the digest recorded from it`);
  ok(digest === BEFORE_TRACE, `and their digest is the one recorded from ${BEFORE_2B}'s own harness (${digest})`);
}

// ---- the falling loop and no hop for a slide (`BodyAnim.slide`) ---------------------------------------------------------------
{
  const tune = JSON.parse(JSON.stringify(ANIM_TUNE_SHIPPED)) as AnimTune;
  const played: string[] = [];
  const rig = { has: () => true, play: (c: string) => { played.push(c); return 1; }, yieldOverride() {}, overrideName: null };
  const a = new BodyAnim(tune, 0.0254);
  a.dropBelow = -1;
  a.slide = true;
  const hop = a.leftGround(rig, false);
  a.jump(rig, false);
  a.forceMove();
  a.vy = -1;
  const loop = a.air(rig, false);
  ok(!hop && played.length === 0 && loop === MX.fall, `a slide is no step off a ledge (no hop over the drop) and its air is the falling loop (${loop}), whatever jump or Force move came before`);
  const b = new BodyAnim(tune, 0.0254);
  b.dropBelow = -1;
  ok(b.leftGround(rig, false) && played.length === 1, 'and without it, a step off with nothing under it hops, as before');
  const p = text('src/player/player.ts');
  ok(p.includes("this.slideFade.fade = LOCO_TUNE.slope.fade;\n        rig.setState('air', 0, null, this.slope.sliding ? this.slideFade : undefined);"), "the player's air state comes in over the slope's own fade while the body slides, and as ever otherwise");
}

// ---- the player's lines are the harness's ---------------------------------------------------------------------------------------
{
  const p = text('src/player/player.ts');
  const h = text('tools/swg/tests/grappleBody.ts');
  const upd = p.slice(p.indexOf('  update(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {'));
  const frame = h.slice(h.indexOf('  frame(dt: number): void {'));
  const at = (s: string, parts: string[]) => {
    let from = 0;
    for (const x of parts) {
      const i = s.indexOf(x, from);
      if (i < 0) return false;
      from = i + x.length;
    }
    return true;
  };
  ok(at(upd, ['const slopeJumped = this.slope.jumpOff(this.vel, c.jumpPressed);', 'if (slopeJumped) this.jka.markJumpStart(this.pos.y);', 'this.jka.step(', 'if (slopeJumped) ev.jumped = true;', 'if (this.slope.sliding) this.slope.share(this.vel, dt,', 'this.grapple.beforeMove(', 'this.slope.sliding ||', 'this.controller.disableSnapToGround();', 'this.slope.controllerFor(this.controller);', 'computeColliderMovement(', 'this.grounded = this.controller.computedGrounded();', 'const slopeAt = this.slope.at;', 'slopeAt.x = this.pos.x;', 'slopeAt.y = this.pos.y;', 'slopeAt.z = this.pos.z;', 'slopeAt.offsetY = this.colliderOffsetY;', 'slopeAt.r = CAPSULE_RADIUS;', 'slopeAt.filter = filter;', "this.grounded = this.slope.judge(this.physics.world, this.grounded, !this.swimming && !this.grapple.attached && !this.grapple.released, this.body, this.walkPast);", 'if (this.slope.sliding) this.jka.holdApex(this.slope.slide(this.vel, this.pos.y,', 'this.anim.slide = this.slope.sliding;', 'if (this.grounded && this.vel.y < 0) this.vel.y = 0;']), "the player's update: the jump off, the share before the move, the snap off and the controller's numbers, the verdict after the controller's word and before the fall is zeroed, the slide and the fall's memory, and the animation's word, in that order");
  ok(at(frame, ['const slopeJumped = this.slope.jumpOff(this.vel, c.jumpPressed);', 'if (slopeJumped) this.jka.markJumpStart(this.pos.y);', 'this.jka.step(', 'if (slopeJumped) ev.jumped = true;', 'if (this.slope.sliding) this.slope.share(this.vel, dt,', 'g.beforeMove(', 'this.slope.sliding ||', 'this.controller.disableSnapToGround();', 'this.slope.controllerFor(this.controller);', 'computeColliderMovement(', 'this.grounded = this.controller.computedGrounded();', 'const slopeAt = this.slope.at;', 'slopeAt.x = this.pos.x;', 'slopeAt.y = this.pos.y;', 'slopeAt.z = this.pos.z;', 'slopeAt.offsetY = this.colliderOffsetY;', 'slopeAt.r = CAPSULE_RADIUS;', 'slopeAt.filter = this.filter;', 'this.grounded = this.slope.judge(this.physics.world, this.grounded, !this.swimming && !(this.hooks && (g.attached || g.released)), this.body, this.walkPast);', 'if (this.slope.sliding) this.jka.holdApex(this.slope.slide(this.vel, this.pos.y,', 'if (this.grounded && this.vel.y < 0) this.vel.y = 0;']), 'and the harness steps the very same calls in the very same order');
  const count = (s: string, x: string) => s.split(x).length - 1;
  // (Climbing II, phase 3: and the bar's take and every frame on it; phase 4: and the rope's; phase 5: and the pole's; phase 6: and
  // the vault's.)
  ok(count(p, 'this.slope.reset();') === 19 && /private takenByVault\(\): void \{[^}]*this\.slope\.reset\(\);/.test(p) && /private vaultFrame\([^)]*\): void \{[^}]*this\.slope\.reset\(\);/.test(p) &&/private takenByPole\(\): void \{[^}]*this\.slope\.reset\(\);/.test(p) && /private poleFrame\([^)]*\): void \{[^}]*this\.slope\.reset\(\);/.test(p) && /private takenByRope\(\): void \{[^}]*this\.slope\.reset\(\);/.test(p) && /private ropeFrame\([^)]*\): void \{[^}]*this\.slope\.reset\(\);/.test(p) && /private takenByBar\(\): void \{[^}]*this\.slope\.reset\(\);/.test(p) && /private barFrame\([^)]*\): void \{[^}]*this\.slope\.reset\(\);/.test(p) && /private takenByLedge\(\): void \{[^}]*this\.slope\.reset\(\);/.test(p) && /private hangFrame\([^)]*\): void \{[^}]*this\.slope\.reset\(\);/.test(p) && /private takenByWall\(\): void \{[^}]*this\.slope\.reset\(\);/.test(p) && /private wallFrame\([^)]*\): void \{[^}]*this\.slope\.reset\(\);/.test(p), "the slide is let go wherever the feet leave the move (the five branches off the feet, `stand`, `reset`, wave 4's grab and every frame of a hang, the wall's take and every frame on it, the bar's, the rope's, the pole's and the vault's)");
  ok(!/SlopeRule|slopeRule/.test(text('src/world/npcs.ts')) && !/SlopeRule|slopeRule/.test(text('src/world/fighterStance.ts')), 'the fighters keep their own controller copy, untouched (measured below)');
}

// ---- mutations of the new code: each fails its check ---------------------------------------------------------------------------
{
  const files = ['tools/swg/tests/grappleBody.ts', 'src/player/slopeRule.ts'];
  const base = new Map(files.map((f) => [f, text(f)]));
  const mutant = async (file: string, from: string, to: string): Promise<Harness> => {
    const m = new Map(base);
    const src = m.get(file)!;
    assert.ok(src.includes(from), `a mutation found nothing to change: ${from}`);
    m.set(file, src.replace(from, to));
    return loadHarness(m);
  };
  const stand = scenes.find((s) => s.name === 'stand terrain 75')!;
  const stand58 = scenes.find((s) => s.name === 'stand trimesh 58')!;
  const drop = (t: number[]) => t[1] - t[t.length - 7];
  rule('limit');
  const verdict = await mutant('src/player/slopeRule.ts', 'if (!grounded || !ruled || !this.on) {', 'if (true) {');
  ok(drop(await stand.run(verdict, 60)) < 0.05, "mutation: the verdict always the controller's word: the body holds on a 75 degree face again (the slide's check fails)");
  const snap = await mutant('tools/swg/tests/grappleBody.ts', 'this.swimming || this.slope.sliding || (this.hooks', 'this.swimming || (this.hooks');
  const d30 = await descent(snap, 30, 75);
  const d144 = await descent(snap, 144, 75);
  ok(Math.abs(d144 - d30) > 0.25 * d30, `mutation: the snap to the ground left on while sliding: it drags the body down the face by a share of its reach every frame, so the slide parts by frame rate (${d30.toFixed(2)} m at 30 against ${d144.toFixed(2)} m at 144 in a third of a second)`);
  ok(drop(await stand58.run(harness, 60)) > 5, 'and the rule itself slides a 58 degree face, the nearest to the limit');
  const fan = await mutant('src/player/slopeRule.ts', 'if (n.y <= 1e-3) continue;', 'if (n.y <= 2) continue;');
  ok(!(await vee(fan)).rests, 'mutation: the fan keeping no face: a body in the V no longer rests (two faces hold it up only where the capsule touches both, which the fan alone finds; the edge probe, finding the faces at the V\'s crease, slides it)');
  const edgeWord = await mutant('src/player/slopeRule.ts', 'return walkable || !steep;', 'return true;');
  ok(endY(await onPeak(edgeWord, 'trimesh', 80, 0.1, 60)) > 9.5, "mutation: an edge always the controller's word: the body perches on the ridge again (the review's finding)");
  const noClipFace = await mutant('src/player/slopeRule.ts', 'if (!steep) this.keep(n.x, n.y, n.z);', 'if (false) this.keep(n.x, n.y, n.z);');
  ok(endY(await onPeak(noClipFace, 'trimesh', 80, 0, 60)) > 9.5, "mutation: the edge's face on the body's side not kept for the clip: a body on the ridge's very top is held there, its fall piling up against the edge");
  const noSkew = await mutant('src/player/slopeRule.ts', 'const s = Math.sin(EDGE_SKEW);', 'const s = 0;');
  ok(endY(await onPeak(noSkew, 'terrain', 80, 0, 60)) > 9.5, "mutation: the edge probe's rays parallel to an axis: on the terrain's ridge top the heightfield misses them once the body is a hair off its grid line, and the body perches again");
  const planeAlways = await mutant('src/player/slopeRule.ts', 'if (d <= PLANE_HOLD && d >= -PLANE_HOLD) {', 'if (true) {');
  ok(groundedBetween(await offLip(planeAlways, 'terrain', 65, 60), 2, LIP_TOP - 0.5), 'mutation: the kept plane held whatever the height: a body walked off a lip is still ground on the steep face below it');
  const stillAlways = await mutant('src/player/slopeRule.ts', 'if (dx <= STILL_HOLD && dx >= -STILL_HOLD && dy <= STILL_HOLD && dy >= -STILL_HOLD && dz <= STILL_HOLD && dz >= -STILL_HOLD) {', 'if (true) {');
  ok(groundedBetween(await offLip(stillAlways, 'trimesh', 80, 60), 2, LIP_TOP - 0.5), "mutation: a lip's stand kept however the body moves: walked on over the edge, it is still ground on the steep face");
  const hangs = await mutant('src/player/slopeRule.ts', 'if (floorNy >= cosLimit && this.slid > 0 && ', 'if (floorNy >= cosLimit && false && ');
  // Wave 3's crease covers a slide landing in a crease too, so this check of the slide's own floor rule is made with it
  // off (the two cover for each other; wave 3's crease suite mutates its own half).
  LOCO_TUNE.slopeCrease = 'before';
  const hung = Math.max(await slideToFloor(hangs, 'trimesh', 89, 6, 60), await slideToFloor(hangs, 'trimesh', 89, 7.3, 60), await slideToFloor(hangs, 'terrain', 89, 6, 60));
  LOCO_TUNE.slopeCrease = 'floor';
  ok(hung > 0.2, `mutation: a sliding body's floor counted wherever the ray meets it: a slide down an 89 degree face hangs ${hung.toFixed(2)} m over the floor again`);
  // And keeping a verdict changes none: the rule kept against the rule asking afresh every frame, frame for frame.
  const fresh = await mutant('src/player/slopeRule.ts', 'if (this.held !== HELD_NONE && world === this.heldWorld && cosLimit === this.heldCos) {', 'if (false) {');
  const kept: [string, (H: Harness) => Promise<number[]>][] = [
    ['walked off a terrain lip of 65 degrees', (H) => offLip(H, 'terrain', 65, 60)],
    ['walked off a model lip of 80 degrees at 144 frames a second', (H) => offLip(H, 'trimesh', 80, 144)],
    ['stood 0.2 m past a model lip', (H) => atLip(H, 'trimesh', 65, 0.2)],
    ['dropped on a ridge 0.1 m off its peak', (H) => onPeak(H, 'trimesh', 80, 0.1, 60)],
    ['stairs up and down', (H) => scenes.find((s) => s.name === 'stairs up and down (the autostep)')!.run(H, 60)],
    ['a 40 degree ramp walked up and back down', (H) => scenes.find((s) => s.name === 'a 40 degree ramp walked up and back down')!.run(H, 144)],
    ['flat ground: walk, back, strafe, Shift', (H) => scenes.find((s) => s.name === 'flat ground: walk, back, strafe, Shift')!.run(H, 30)],
    ['standing on a 75 degree face', (H) => scenes.find((s) => s.name === 'stand terrain 75')!.run(H, 60)],
  ];
  for (const [name, run] of kept) {
    rule('limit');
    const a = await run(harness);
    const b2 = await run(fresh);
    ok(same(a, b2), `kept verdicts against fresh ones, ${name}: frame for frame the same (${a.length / 8} frames; ${firstDiff(a, b2)})`);
  }
  const clip = await mutant('src/player/slopeRule.ts', '      if (d < 0) {\n        vel.x -= this.nx[i] * d;', '      if (d > 0) {\n        vel.x -= this.nx[i] * d;');
  const ct = await stand.run(clip, 60);
  const cs = await stand.run(harness, 60);
  // The speed pressing into the 75 degree face while the body is up on it (its normal (-sin 75, cos 75, 0)).
  const n75 = faceAt(75, 1).n;
  const into = (t: number[]) => Math.max(0, ...Array.from({ length: t.length / 8 }, (_, i) => i).filter((i) => t[i * 8 + 1] > 2 && t[i * 8 + 1] < 9).map((i) => -(t[i * 8 + 3] * n75.x + t[i * 8 + 4] * n75.y + t[i * 8 + 5] * n75.z)));
  ok(!same(ct, cs) && into(ct) > 1 && into(cs) < 0.1, `mutation: the clip turned round: the speed piles up into the face (pressing into it at up to ${into(ct).toFixed(2)} m/s up on the face, against the rule's ${into(cs).toFixed(3)})`);
  const share = await mutant('src/player/slopeRule.ts', 'const take = Math.min(down, (1 - keep) * g * sin * dt);', 'const take = 0;');
  LOCO_TUNE.slope.slide = 0.5;
  const { b, p } = await bodyIn(share, (pp) => face(pp, 'terrain', 75));
  const f = faceAt(75, 25);
  const c = f.p.clone().addScaledVector(f.n, R + 0.04);
  b.place(c.x, c.y - R, c.z);
  b.run(60, 1 / 3);
  const v1 = b.vel.length();
  b.run(60, 1 / 3);
  p.world.free();
  const want = (0.5 * b.jka.gravity * Math.sin((75 * Math.PI) / 180)) / 3;
  ok(Math.abs(b.vel.length() - v1 - want) > want * 0.5, "mutation: the share never taken: the slide's speed check at a share of 0.5 fails");
  restore();
}

// ---- the fighters' own controller copy: measured, left as it is ---------------------------------------------------------------
{
  for (const deg of [58, 65, 75, 89]) {
    const p = await makePhysics();
    face(p, 'terrain', deg);
    p.stepOnce();
    const { p: fp, n } = faceAt(deg, 10);
    const c = fp.clone().addScaledVector(n, R + 0.06);
    const pos = new THREE.Vector3(c.x, c.y - R, c.z);
    const body = p.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z));
    const col = p.world.createCollider(RAPIER.ColliderDesc.capsule(0.45, R).setTranslation(0, R + 0.45, 0), body);
    const ctl = p.world.createCharacterController(FIGHTER_BODY.offset);
    applyBody(ctl);
    const ft = { y: pos.y, grounded: false, fallVy: 0 };
    const t = Math.tan((deg * Math.PI) / 180);
    let groundedAll = true;
    const y0 = pos.y;
    for (let i = 0; i < 120; i++) {
      const dy = fallSpeed(ft as never, 1 / 60);
      ctl.computeColliderMovement(col, { x: 0, y: dy, z: 0 }, undefined, groups(Group.all, Group.all), (cc) => { const bb = cc.parent(); return !bb || bb.isFixed(); });
      const mv = ctl.computedMovement();
      pos.x += mv.x;
      pos.y += mv.y;
      pos.z += mv.z;
      ft.grounded = ctl.computedGrounded();
      if (!ft.grounded) groundedAll = false;
      ft.y = pos.y;
      settleFooting(ft as never, pos.x <= X0 ? 0 : (pos.x - X0) * t);
      pos.y = ft.y;
      body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
      p.step(1 / 60);
    }
    p.world.free();
    note(`a fighter stood on a ${deg} degree face: grounded every frame ${groundedAll}, slid ${(y0 - pos.y).toFixed(2)} m in 2 s (free sliding would be ${(0.5 * 18 * Math.sin((deg * Math.PI) / 180) ** 2 * 4).toFixed(1)})`);
  }
}

// The rule's own record answers for nothing until asked.
{
  const s = new SlopeRule();
  ok(!s.sliding && s.count === 0 && Number.isNaN(s.rayNy), 'a fresh rule slides nothing');
}
restore();
console.log(`slopeLimit: ${checks} checks passed`);
