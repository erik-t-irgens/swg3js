// Wave 3 of the animations, item C: the crease (wave 2b's leftover, src/player/slopeRule.ts's `CREASE_*`). A body dropped
// straight into the crease where a face too steep to stand on meets the floor came to rest leaning on the face over the
// floor (42 of the 192 drops below, 0.08 to 0.32 m up, measured before the mend). Driven through the tests' own body
// (grappleBody.ts: the player's controller, its slope rule and its syncing of the capsule's collider while a crease
// settles), on terrain and on trimeshes, at 60 and 144 frames a second:
//  - all 192 drops end on the floor under the crease's mend, and under 'before' some still hang (the fault the test sees);
//  - what the mend must not touch is the rule before it frame for frame: a kerb walked onto plain and bevelled at 62 to 80
//    degrees, the autostep up and down a staircase, a drop onto open ground and one beside a sheer wall, a jump's landing;
//  - day one: 'before' is 23d7898's own harness and slope rule (read out of git) over every scene, drops included, and the
//    unaffected scenes are under the mend as well; a recorded digest where git cannot answer;
//  - mutations: the floor's crease reach not asked, the collider not synced, the crease never armed, each failing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RAPIER, TRIMESH_FLAGS, cleanTrimesh, Group, groups } from '../../../src/core/physics.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';
import { REPO, oldTexts } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

/** The commit wave 3 started from. */
const PRE_WAVE = '23d7898';
/** The digest of the scenes' traces under 23d7898's own harness and slope rule (what a checkout with no history is held to). */
const BEFORE_TRACE = '82f05dd065fa6bca';

type Harness = typeof import('./grappleBody.ts');
type Physics = Awaited<ReturnType<Harness['makePhysics']>>;

/** A copy of the harness (and, from `texts`, the files it names), every other relative import pointed at this checkout. */
async function loadHarness(texts: Map<string, string>): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'crease-harness-'));
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
const HARNESS_FILES = ['tools/swg/tests/grappleBody.ts', 'src/player/slopeRule.ts'];
const textsNow = (): Map<string, string> => new Map(HARNESS_FILES.map((f) => [f, readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n')]));
const now = (await import('./grappleBody.ts')) as Harness;

/** A prism with no body: a face rising from x0 at `deg` to `h` and a flat top to x0 + len, then down sheer; as a trimesh. */
function prism(p: Physics, x0: number, deg: number, h: number, len: number, half = 10): void {
  const run = h / Math.tan((deg * Math.PI) / 180);
  const x1 = x0 + run;
  const x2 = x0 + len;
  const v = new Float32Array([x0, 0, -half, x1, h, -half, x2, h, -half, x2, 0, -half, x0, 0, half, x1, h, half, x2, h, half, x2, 0, half]);
  const idx = new Uint32Array([0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 0, 1, 2, 0, 2, 3, 4, 7, 6, 4, 6, 5, 0, 3, 7, 0, 7, 4]);
  const c = cleanTrimesh(v, idx)!;
  const d = RAPIER.ColliderDesc.trimesh(c.vertices, c.indices, TRIMESH_FLAGS).setFriction(0.8);
  d.setCollisionGroups(groups(Group.exterior, Group.all));
  p.world.createCollider(d);
}

/** A steep face rising from x = X0 (a heightfield's or a trimesh wedge's), the floor at nought round it. */
const X0 = 32;
function face(H: Harness, p: Physics, kind: 'terrain' | 'trimesh', deg: number): void {
  const t = Math.tan((deg * Math.PI) / 180);
  if (kind === 'terrain') H.heightChunk(p, 0, -32, (x) => (x <= X0 ? 0 : (x - X0) * t));
  else {
    H.ground(p, 0);
    const Hh = 30;
    const L = Hh / t;
    const W = 10;
    const v = new Float32Array([X0, 0, -W, X0 + L, 0, -W, X0 + L, Hh, -W, X0, 0, W, X0 + L, 0, W, X0 + L, Hh, W]);
    const idx = new Uint32Array([0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3, 0, 2, 1, 3, 4, 5]);
    const c = cleanTrimesh(v, idx)!;
    const d = RAPIER.ColliderDesc.trimesh(c.vertices, c.indices, TRIMESH_FLAGS).setFriction(0.8);
    d.setCollisionGroups(groups(Group.exterior, Group.all));
    p.world.createCollider(d);
  }
}

/** Every frame's place, speed and footing, rounded to the float's own bits. */
function runTrace(b: InstanceType<Harness['TestBody']>, fps: number, seconds: number, keys: [number, number, string][], out: number[]): void {
  const down = new Set<string>();
  b.run(fps, seconds, (t) => {
    for (const [from, to, code] of keys) {
      const want = t >= from && t < to;
      if (want !== down.has(code)) {
        b.key(code, want);
        if (want) down.add(code);
        else down.delete(code);
      }
    }
    out.push(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.grounded ? 1 : 0);
  });
}

interface Scene {
  name: string;
  /** Whether the crease's mend leaves it as the rule before it was. */
  untouched: boolean;
  run(H: Harness, fps: number): Promise<number[]>;
}
const scenes: Scene[] = [];
for (const deg of [62, 70, 80]) {
  scenes.push({
    name: `a 0.3 m kerb bevelled at ${deg} degrees, walked onto`,
    untouched: true,
    async run(H, fps) {
      const p = await H.makePhysics();
      H.ground(p, 0);
      prism(p, 3, deg, 0.3, 6);
      p.stepOnce();
      const b = new H.TestBody(p);
      b.place(0, 0.02, 0.3);
      const out: number[] = [];
      runTrace(b, fps, 4, [[0.1, 3.5, 'KeyW']], out);
      p.world.free();
      return out;
    },
  });
}
scenes.push({
  name: 'a plain 0.3 m kerb walked onto and off',
  untouched: true,
  async run(H, fps) {
    const p = await H.makePhysics();
    H.ground(p, 0);
    H.box(p, [3, 0, -6], [5, 0.3, 6]);
    p.stepOnce();
    const b = new H.TestBody(p);
    b.place(0, 0.02, 0.3);
    const out: number[] = [];
    runTrace(b, fps, 4, [[0.1, 3.5, 'KeyW']], out);
    p.world.free();
    return out;
  },
});
scenes.push({
  name: 'the autostep up and down a staircase',
  untouched: true,
  async run(H, fps) {
    const p = await H.makePhysics();
    H.ground(p, 0);
    for (let i = 0; i < 6; i++) H.box(p, [3 + i * 0.6, 0, -2], [3 + (i + 1) * 0.6, (i + 1) * 0.25, 2]);
    H.box(p, [6.6, 0, -2], [8.6, 1.5, 2]);
    for (let i = 0; i < 6; i++) H.box(p, [8.6 + i * 0.6, 0, -2], [8.6 + (i + 1) * 0.6, 1.5 - (i + 1) * 0.25, 2]);
    p.stepOnce();
    const b = new H.TestBody(p);
    b.place(1, 0.02, 0);
    const out: number[] = [];
    runTrace(b, fps, 5, [[0.1, 4.5, 'KeyW']], out);
    p.world.free();
    return out;
  },
});
scenes.push({
  name: 'a drop of 4 m onto open ground',
  untouched: true,
  async run(H, fps) {
    const p = await H.makePhysics();
    H.ground(p, 0);
    p.stepOnce();
    const b = new H.TestBody(p);
    b.place(0, 4, 0);
    const out: number[] = [];
    runTrace(b, fps, 2, [], out);
    p.world.free();
    return out;
  },
});
scenes.push({
  name: 'a drop of 4 m beside a sheer wall',
  untouched: true,
  async run(H, fps) {
    const p = await H.makePhysics();
    H.ground(p, 0);
    H.box(p, [0.36, 0, -4], [2, 6, 4]);
    p.stepOnce();
    const b = new H.TestBody(p);
    b.place(0, 4, 0);
    const out: number[] = [];
    runTrace(b, fps, 2, [], out);
    p.world.free();
    return out;
  },
});
scenes.push({
  name: 'a jump on flat ground and its landing',
  untouched: true,
  async run(H, fps) {
    const p = await H.makePhysics();
    H.ground(p, 0);
    p.stepOnce();
    const b = new H.TestBody(p);
    b.place(0, 0.02, 0);
    const out: number[] = [];
    runTrace(b, fps, 2.5, [[0.3, 0.45, 'Space'], [0.1, 2, 'KeyW']], out);
    p.world.free();
    return out;
  },
});
/** A drop straight down beside a steep face, its capsule's side just touching the face low down. */
async function drop(H: Harness, kind: 'terrain' | 'trimesh', deg: number, gap: number, h: number, fps: number, out?: number[]): Promise<{ y: number; grounded: boolean; creases: number }> {
  const p = await H.makePhysics();
  face(H, p, kind, deg);
  p.stepOnce();
  const b = new H.TestBody(p);
  const t = Math.tan((deg * Math.PI) / 180);
  b.place(X0 + 0.5 / t - 0.39 + gap, h, 0.3);
  if (out) runTrace(b, fps, 3, [], out);
  else b.run(fps, 3);
  const r = { y: b.pos.y, grounded: b.grounded, creases: (b.slope as { creases?: number }).creases ?? 0 };
  p.world.free();
  return r;
}
const DROPS: [('terrain' | 'trimesh'), number, number, number, number][] = [];
for (const kind of ['terrain', 'trimesh'] as const) for (const deg of [75, 85, 89]) for (const gap of [-0.02, 0, 0.02, 0.05]) for (const h of [2, 3.1, 4.7, 6.3]) for (const fps of [60, 144]) DROPS.push([kind, deg, gap, h, fps]);
async function hanging(H: Harness): Promise<{ hung: string[]; creases: number }> {
  const hung: string[] = [];
  let creases = 0;
  for (const [kind, deg, gap, h, fps] of DROPS) {
    const r = await drop(H, kind, deg, gap, h, fps);
    creases += r.creases;
    if (r.y > 0.08) hung.push(`${kind} ${deg} degrees, ${gap} m off, from ${h} m at ${fps} fps: ${r.y.toFixed(3)} m up`);
  }
  return { hung, creases };
}

/**
 * The drops at 240 frames a second, where the capsule's collider stands up to four frames behind the body: how many still
 * bounce (over 0.08 m up, moving more than 2 cm or flipping their footing more than four times) in their last 1.5 s.
 */
async function bouncing(H: Harness, fps = 240): Promise<{ bad: number; worst: number }> {
  let bad = 0;
  let worst = 0;
  for (const [kind, deg, gap, h, f] of DROPS) {
    if (f !== 60) continue;
    const p = await H.makePhysics();
    face(H, p, kind, deg);
    p.stepOnce();
    const b = new H.TestBody(p);
    const t = Math.tan((deg * Math.PI) / 180);
    b.place(X0 + 0.5 / t - 0.39 + gap, h, 0.3);
    let hi = -Infinity;
    let lo = Infinity;
    let flips = 0;
    let was: boolean | null = null;
    b.run(fps, 3, (tt) => {
      if (tt <= 1.5) return;
      hi = Math.max(hi, b.pos.y);
      lo = Math.min(lo, b.pos.y);
      if (was !== null && was !== b.grounded) flips++;
      was = b.grounded;
    });
    if (hi > 0.08 || hi - lo > 0.02 || flips > 4) bad++;
    worst = Math.max(worst, hi - lo);
    p.world.free();
  }
  return { bad, worst };
}

const crease = (v: 'floor' | 'before') => {
  LOCO_TUNE.slopeCrease = v;
};
const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const firstDiff = (a: number[], b: number[]) => {
  if (a.length !== b.length) return `${a.length / 7} frames against ${b.length / 7}`;
  const i = a.findIndex((v, k) => !Object.is(v, b[k]));
  return i < 0 ? 'every frame alike' : `first apart at frame ${Math.floor(i / 7)}`;
};

// ---- the drops ------------------------------------------------------------------------------------------------------------
crease('floor');
const mended = await hanging(now);
ok(mended.hung.length === 0, `all ${DROPS.length} drops beside a face of 75, 85 or 89 degrees (terrain and trimesh, 60 and 144 frames a second) end on the floor (${mended.creases} creases met)${mended.hung.length ? `: ${mended.hung.join('; ')}` : ''}`);
crease('before');
const before = await hanging(now);
note(`under 'before', ${before.hung.length} of the ${DROPS.length} hang over 0.08 m (${before.hung.slice(0, 4).join('; ')}${before.hung.length > 4 ? '; ...' : ''})`);
ok(before.hung.length > 0 && before.creases === 0, `and under 'before' the fault is there to be seen (${before.hung.length} hang) and no crease is ever met`);
crease('floor');
{
  const b240 = await bouncing(now);
  ok(b240.bad === 0, `the same 96 drops at 240 frames a second come to rest in the crease (none bounce in their last 1.5 s; the most any moves ${b240.worst.toFixed(3)} m): the collider put where the body is while a crease settles`);
}

// ---- what the mend must not touch ------------------------------------------------------------------------------------------
for (const s of scenes) {
  for (const fps of [30, 60, 144]) {
    crease('before');
    const a = await s.run(now, fps);
    crease('floor');
    const b2 = await s.run(now, fps);
    ok(same(a, b2), `${s.name}, at ${fps} frames a second: under the crease's mend it is the rule before frame for frame (${firstDiff(a, b2)})`);
  }
}

// ---- day one ----------------------------------------------------------------------------------------------------------------
{
  const old = oldTexts(HARNESS_FILES, PRE_WAVE);
  const oldH = old ? await loadHarness(old) : null;
  const traces: number[][] = [];
  // Stairs II's step-up mend is a switch of its own with its own day one (playerStepUp.test.ts): 'before' here, since the harness
  // this compares with has none (it moves the 144 fps scenes, whose collider stood a frame or two behind the body).
  LOCO_TUNE.step.rule = 'before';
  crease('before');
  for (const s of scenes) {
    const a = await s.run(now, 60);
    traces.push(a);
    if (oldH) {
      const b2 = await s.run(oldH, 60);
      ok(same(a, b2), `day one, ${s.name}: under 'before' the harness and slope rule are ${PRE_WAVE}'s own, frame for frame (${firstDiff(a, b2)})`);
    }
  }
  for (const [kind, deg, gap, h, fps] of DROPS.filter((_d, i) => i % 16 === 0)) {
    const a: number[] = [];
    await drop(now, kind, deg, gap, h, fps, a);
    traces.push(a);
    if (oldH) {
      const b2: number[] = [];
      await drop(oldH, kind, deg, gap, h, fps, b2);
      ok(same(a, b2), `day one, a drop beside a ${deg} degree ${kind} face at ${fps} fps: under 'before' it is ${PRE_WAVE}'s own, frame for frame (${firstDiff(a, b2)})`);
    }
  }
  crease('floor');
  if (oldH) {
    for (const s of scenes) {
      const a = await s.run(now, 144);
      const b2 = await s.run(oldH, 144);
      ok(same(a, b2), `day one, ${s.name} at 144 fps under the mend: ${PRE_WAVE}'s own, frame for frame (${firstDiff(a, b2)})`);
    }
  }
  LOCO_TUNE.step.rule = 'mended';
  const digest = createHash('sha1').update(traces.map((t) => t.join(',')).join('\n')).digest('hex').slice(0, 16);
  if (oldH) note(`the 'before' traces' digest is ${digest} (BEFORE_TRACE, which a checkout with no history is held to)`);
  else note(`git cannot hand over ${PRE_WAVE}'s harness here: the 'before' traces are held to the digest recorded from it`);
  ok(digest === BEFORE_TRACE, `and their digest is the one recorded from ${PRE_WAVE}'s own harness (${digest})`);
}

// ---- mutations --------------------------------------------------------------------------------------------------------------
{
  const mutant = async (file: string, from: string, to: string): Promise<Harness> => {
    const t = textsNow();
    const src = t.get(file)!;
    assert.ok(src.includes(from), `a mutation found nothing to change in ${file}: ${from}`);
    t.set(file, src.replace(from, to));
    return loadHarness(t);
  };
  crease('floor');
  const noReach = await mutant('src/player/slopeRule.ts', "LOCO_TUNE.slopeCrease === 'floor' && hit!.timeOfImpact * floorNy - r > CREASE_TOUCH", 'false');
  ok((await hanging(noReach)).hung.length > 0, 'mutation: the floor counted wherever the ray meets it while a crease settles: drops hang again');
  const noSync = await mutant('tools/swg/tests/grappleBody.ts', '} else if (this.slope.settling) this.collider.setTranslation(', '} else if (false) this.collider.setTranslation(');
  // Under the step-up as it was (Stairs II's 'before'): the crease's own sync is the only one (under its mend the collider is
  // put where the body is before every move, the crease's frames included, so this mutant settles as the crease does).
  LOCO_TUNE.step.rule = 'before';
  ok((await bouncing(noSync)).bad > 0, 'mutation: the capsule\'s collider not put where the body is while a crease settles: drops at 240 frames a second bounce over the floor');
  LOCO_TUNE.step.rule = 'mended';
  ok((await bouncing(noSync)).bad === 0, 'and under the step-up\'s mend (the collider put where the body is before every move) the same drops come to rest in the crease without it');
  const noArm = await mutant('src/player/slopeRule.ts', "if (LOCO_TUNE.slopeCrease !== 'floor' || !(this.at.fall > CREASE_FALL)) return;", 'return;');
  ok((await hanging(noArm)).hung.length > 0, 'mutation: no landing ever a crease: drops hang again');
}

console.log(`slopeCrease: ${checks} checks passed`);
