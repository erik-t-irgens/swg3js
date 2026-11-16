// Wave 3 of the animations, item B: stairs found by a rule (src/anim/stairsRule.ts, the owner's brief's line 52), never by
// a mesh's name, and the stair clips' strides measured off the rig.
//
// The rule over heights laid out by hand (risers of 0.15, 0.25 and 0.4 m, up and down; ramps of 10 to 45 degrees; a single
// kerb; a wall; a bump; ground not found), and its hold; then on the real Rapier (`StairSense`, the very sampler the
// player and every other player's figure read stairs with): a staircase of risers 0.15, 0.25 and 0.4 m as a trimesh walked
// up and down at a walk's and a run's pace, a ramp and a single kerb, and the casts the sampler costs; and, where the
// converted packs are on this machine (`SWG3JS_PACKS`), the staircases of two of the game's own buildings found. Then the
// stair clips fitted to the human male's own rig as the pack fits them (the net climb taken out, played round): each one's
// stride along the stairs measured, the tune's `made.*` held to it, and the rate each class needs to keep its feet on
// the treads said. Mutations of the rule, each failing its check.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { RAPIER, TRIMESH_FLAGS, cleanTrimesh, Physics, Group, groups } from '../../../src/core/physics.ts';
import { LOCO_TUNE, LOCO_TUNE_SHIPPED } from '../../../src/anim/locoTune.ts';
import { StairsFound, StairsHold, stairsIn } from '../../../src/anim/stairsRule.ts';
import { StairSense } from '../../../src/player/stairSense.ts';
import { STAIR_CLIPS, STAIR_IDS } from '../../../src/anim/locoTable.ts';
import { MixamoPack } from '../../../src/anim/mixamoPack.ts';
import { REPO } from './oldModules.ts';
import { PACKS } from './materialsHarness.ts';
import { glbSkeleton, speciesBodies } from './animFixtures.ts';
// @ts-expect-error the walk grid's own reader of a GLB's triangles, plain JavaScript
const { readGlbTriangles } = await import('../navgrid.mjs');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const T = () => JSON.parse(JSON.stringify(LOCO_TUNE_SHIPPED.stairs)) as typeof LOCO_TUNE.stairs;

// ---- the rule over heights laid out by hand -------------------------------------------------------------------------------
type Rule = typeof stairsIn;
/** Heights along a line every `step` from `from`, by a ground of `h(x)`. */
function line(h: (x: number) => number, from = -0.8, n = 17, step = 0.1): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = h(from + i * step);
  return out;
}
/** A staircase rising `riser` every `tread`, its first riser at `x0`; `sign` -1 falls. */
const stairs = (riser: number, tread: number, x0 = -0.37, sign = 1) => (x: number) => sign * riser * Math.max(0, Math.floor((x - x0) / tread) + 1);
const ramp = (deg: number) => (x: number) => Math.tan((deg * Math.PI) / 180) * x;
const kerb = (h: number, x0 = 0.03) => (x: number) => (x >= x0 ? h : 0);

function wayOf(rule: Rule, h: Float64Array, tune = T(), step = 0.1): number {
  return rule(h, h.length, step, tune, new StairsFound());
}

interface RuleVerdict {
  found: boolean;
  notRamp: boolean;
  notTerrace: boolean;
  notKerb: boolean;
  notLedge: boolean;
  walls: boolean;
  holes: boolean;
  bumps: boolean;
  slanted: boolean;
}
function ruleChecks(rule: Rule): RuleVerdict {
  let found = true;
  for (const riser of [0.15, 0.25, 0.4]) for (const tread of [0.25, 0.3, 0.45]) for (const x0 of [-0.37, -0.31, -0.24]) {
    if (wayOf(rule, line(stairs(riser, tread, x0))) !== 1) found = false;
    if (wayOf(rule, line(stairs(riser, tread, x0, -1))) !== -1) found = false;
  }
  let notRamp = true;
  for (const deg of [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]) if (wayOf(rule, line(ramp(deg))) !== 0 || wayOf(rule, line(ramp(-deg))) !== 0) notRamp = false;
  // Terraces: a slanted rise of 0.2 m over half a metre, then 0.3 m level, again and again (a riser must be steep).
  const terrace = (x: number) => {
    const p = ((x + 0.8) % 0.8 + 0.8) % 0.8;
    const n = Math.floor((x + 0.8) / 0.8);
    return n * 0.2 + (p < 0.5 ? (p / 0.5) * 0.2 : 0.2);
  };
  const notTerrace = wayOf(rule, line(terrace)) === 0;
  let notKerb = true;
  for (const h of [0.1, 0.15, 0.25, 0.4]) if (wayOf(rule, line(kerb(h))) !== 0 || wayOf(rule, line(kerb(-h))) !== 0) notKerb = false;
  // A kerb with a lip: two rises of 0.15 m with a 0.1 m ledge between, read every 5 cm (a ledge is no tread).
  const notLedge = wayOf(rule, line((x) => (x < 0.03 ? 0 : x < 0.13 ? 0.15 : 0.3), -0.8, 33, 0.05), T(), 0.05) === 0;
  // A wall between the two risers of a staircase breaks it where it stands (with one riser each side, none is stairs).
  const twoRisers = stairs(0.25, 0.6, -0.2);
  const walls = wayOf(rule, line(twoRisers)) === 1 && wayOf(rule, line((x) => (x > 0.05 && x < 0.25 ? 3 : twoRisers(x)))) === 0;
  const holed = line(stairs(0.2, 0.6));
  const holes = wayOf(rule, holed) === 1 && ((holed[8] = Number.NaN), wayOf(rule, holed) === 0);
  const bumps = wayOf(rule, line((x) => 0.05 * Math.max(0, Math.floor((x + 0.37) / 0.3) + 1))) === 0;
  // Treads not quite level (the stairs' line tilted 6 degrees, or a ray's noise): still stairs.
  const slanted = wayOf(rule, line((x) => stairs(0.2, 0.3)(x) + 0.1 * x)) === 1;
  return { found, notRamp, notTerrace, notKerb, notLedge, walls, holes, bumps, slanted };
}

const now = ruleChecks(stairsIn);
ok(now.found, 'staircases of risers 0.15, 0.25 and 0.4 m on treads of 0.25, 0.3 and 0.45 m, wherever they fall in the window, are found, going up as up and going down as down');
ok(now.slanted, 'and so are stairs whose treads are not quite level (within `level`)');
ok(now.notRamp, 'a ramp of 5 to 50 degrees, up or down, is no stairs (it rises in every gap or in none: never a riser)');
ok(now.notTerrace, 'nor are terraces whose rises are slanted (a rise over more than `riserRun` is no riser)');
ok(now.notKerb, 'a single kerb of 0.1 to 0.4 m, up or down, is no stairs (one riser alone)');
ok(now.notLedge, 'nor a kerb with a 0.1 m lip on it read every 5 cm (a ledge shorter than `treadMin` is no tread)');
ok(now.walls && now.holes, 'a wall between two risers breaks the stairs where it stands, and so does ground not found');
ok(now.bumps, 'steps lower than the least riser (5 cm) are bumps, not stairs');
{
  const hold = new StairsHold();
  const tune = T();
  const f = new StairsFound();
  stairsIn(line(stairs(0.2, 0.3)), 17, 0.1, tune, f);
  hold.step(f, 0.1, tune);
  const flat = new StairsFound();
  stairsIn(line(() => 0), 17, 0.1, tune, flat);
  let kept = 0;
  let way = hold.way;
  for (let i = 0; i < 20 && way !== 0; i++) {
    way = hold.step(flat, 0.125, tune);
    if (way !== 0) kept++;
  }
  ok(kept === 3, `held on stairs until stairs.leave (0.5 m) is travelled with no riser in the window: ${kept} steps of 0.125 m kept, the fourth lets go`);
  const one = new StairsFound();
  stairsIn(line(kerb(0.2)), 17, 0.1, tune, one);
  hold.step(f, 0.1, tune);
  for (let i = 0; i < 30; i++) hold.step(one, 0.05, tune);
  ok(hold.way === 1, 'a riser of the way held in the window keeps the stairs however far is travelled (a landing between two flights)');
  const down = new StairsFound();
  stairsIn(line(stairs(0.2, 0.3, -0.37, -1)), 17, 0.1, tune, down);
  ok(hold.step(down, 0.1, tune) === -1, 'and stairs found the other way take over at once (the body turned round on them)');
}

// ---- on the real Rapier --------------------------------------------------------------------------------------------------
function trimeshBox(p: Physics, min: number[], max: number[]): void {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const v = new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]);
  const idx = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
  const c = cleanTrimesh(v, idx)!;
  const d = RAPIER.ColliderDesc.trimesh(c.vertices, c.indices, TRIMESH_FLAGS);
  d.setCollisionGroups(groups(Group.exterior, Group.all));
  p.world.createCollider(d);
}
/** A world: flat ground, and a flight up from x = 3 (`n` risers of `riser` on treads of `tread`), a landing, and a flight down. */
async function staircase(riser: number, tread: number, n = 6): Promise<{ p: Physics; top: number; end: number }> {
  const p = await Physics.create();
  trimeshBox(p, [-40, -1, -6], [60, 0, 6]);
  for (let i = 0; i < n; i++) trimeshBox(p, [3 + i * tread, 0, -2], [3 + (i + 1) * tread, (i + 1) * riser, 2]);
  const land = 3 + n * tread;
  trimeshBox(p, [land, 0, -2], [land + 2, n * riser, 2]);
  for (let i = 0; i < n - 1; i++) trimeshBox(p, [land + 2 + i * tread, 0, -2], [land + 2 + (i + 1) * tread, (n - i - 1) * riser, 2]);
  p.stepOnce();
  return { p, top: n * riser, end: land + 2 + n * tread };
}
/** A body's walk along +x from `x0` to `x1` at `speed`, standing on the ground under it: the way held at each place, and the casts. */
function walk(p: Physics, sense: StairSense, x0: number, x1: number, speed: number, fps: number, groundAt: (x: number) => number): { at: number[]; way: number[]; casts: number } {
  const at: number[] = [];
  const way: number[] = [];
  const dt = 1 / fps;
  const casts0 = sense.casts;
  const dir = Math.sign(x1 - x0);
  for (let x = x0; dir > 0 ? x < x1 : x > x1; x += dir * speed * dt) {
    const a = sense.at;
    a.x = x;
    a.y = groundAt(x);
    a.z = 0;
    a.vx = dir * speed;
    a.vz = 0;
    a.dt = dt;
    a.filter = groups(Group.all, Group.all);
    a.reads = true;
    sense.step(p.world, LOCO_TUNE.stairs);
    at.push(x);
    way.push(sense.way);
  }
  return { at, way, casts: sense.casts - casts0 };
}
{
  const rows: string[] = [];
  let allUp = true;
  let allDown = true;
  let quietFlat = true;
  for (const riser of [0.15, 0.25, 0.4]) {
    const tread = 0.3;
    const { p, top, end } = await staircase(riser, tread);
    const n = 6;
    const land = 3 + n * tread;
    const groundAt = (x: number) => (x < 3 ? 0 : x < land ? Math.min(n, Math.floor((x - 3) / tread) + 1) * riser : x < land + 2 ? top : x < end ? Math.max(0, n - 1 - Math.floor((x - land - 2) / tread)) * riser : 0);
    for (const speed of [1.66, 4]) {
      for (const fps of [60, 144]) {
        const sense = new StairSense();
        const w = walk(p, sense, -3, end + 3, speed, fps, groundAt);
        const wayAt = (x: number) => w.way[w.at.findIndex((v) => v >= x)];
        // Up the flight: held up from its second riser in the window; down the far flight: held down; flat ground far off: none.
        const up = wayAt(3 + 1.5 * tread) === 1 && wayAt(land - 0.2) === 1;
        const down = wayAt(land + 2 + 1.5 * tread) === -1 && wayAt(end - 0.2) === -1;
        const flat = wayAt(-2) === 0 && wayAt(end + 2.5) === 0;
        if (!up) allUp = false;
        if (!down) allDown = false;
        if (!flat) quietFlat = false;
        rows.push(`riser ${riser} at ${speed} m/s, ${fps} fps: up ${up}, down ${down}, flat ${flat}; ${w.casts} casts over ${(end + 6).toFixed(1)} m`);
      }
    }
    p.world.free();
  }
  for (const r of rows) note(r);
  ok(allUp && allDown && quietFlat, 'a staircase of risers 0.15, 0.25 and 0.4 m as a trimesh, walked over at a walk\'s and a jog\'s pace at 60 and 144 frames a second: held up on the flight up, down on the flight down, and off on the flat ground beyond');
  // The casts: one new sample a step of the lattice, so about the distance over the step whatever the frame rate.
  const castsLine = rows.find((r) => r.startsWith('riser 0.25 at 1.66 m/s, 60'))!;
  const casts = Number(/; (\d+) casts/.exec(castsLine)![1]);
  ok(casts > 0 && casts < ((3 + 6 * 0.3 + 2 + 6 * 0.3 + 6) / LOCO_TUNE.stairs.step) * 1.3 + 20, `the samples cost one ray a lattice step walked (${casts} over ${(3 + 6 * 0.3 + 2 + 6 * 0.3 + 6).toFixed(1)} m at 0.1 m): a sample once cast is read back, not cast again`);
  // A ramp and a kerb in the world.
  const p = await Physics.create();
  trimeshBox(p, [-40, -1, -6], [60, 0, 6]);
  {
    const t = Math.tan((30 * Math.PI) / 180);
    const v = new Float32Array([3, 0, -2, 9, 6 * t, -2, 9, 0, -2, 3, 0, 2, 9, 6 * t, 2, 9, 0, 2]);
    const idx = new Uint32Array([0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 0, 2, 5, 0, 5, 3]);
    const c = cleanTrimesh(v, idx)!;
    p.world.createCollider(RAPIER.ColliderDesc.trimesh(c.vertices, c.indices, TRIMESH_FLAGS));
  }
  trimeshBox(p, [20, 0, -2], [30, 0.2, 2]);
  p.stepOnce();
  const sense = new StairSense();
  const w = walk(p, sense, 0, 32, 1.66, 60, (x) => (x >= 3 && x < 9 ? (x - 3) * Math.tan((30 * Math.PI) / 180) : x >= 20 && x < 30 ? 0.2 : 0));
  ok(w.way.every((v) => v === 0), 'a 30 degree ramp walked up and a 0.2 m kerb stepped up and down are no stairs');
  p.world.free();
  // Standing still costs nothing.
  {
    const { p: q } = await staircase(0.25, 0.3);
    const s = new StairSense();
    const a = s.at;
    Object.assign(a, { x: 4, y: 0.5, z: 0, vx: 0, vz: 0, dt: 1 / 60, filter: groups(Group.all, Group.all), reads: true });
    for (let i = 0; i < 60; i++) s.step(q.world, LOCO_TUNE.stairs);
    ok(s.casts === 0, 'standing still on stairs casts nothing');
    q.world.free();
  }
}

// ---- the game's own buildings, where the packs are here --------------------------------------------------------------------
// Three of the game's own staircases, found by scanning every line of every storey of the converted guild halls, guard
// houses and starports with the rule (risers of 0.153 m on 0.3 m treads, 0.2 on 0.25 going down, 0.145 on 0.4): walked
// up or down each by the very sampler a body reads stairs with, standing on the floor a ray finds under it.
{
  const lines = [
    { file: 'mun_nboo_guild_theater_s01.glb', axis: 'x', c: 49.64, from: -14.5, to: -10.5, lvl: 2.24, way: 1, what: 'a theatre\'s stairs up to its stage' },
    { file: 'mun_all_military_base_guard_house_impl_s01.glb', axis: 'x', c: -3.25, from: -3.3, to: -0.6, lvl: 6.4, way: -1, what: 'a guard house\'s stairs down from its upper floor' },
    { file: 'mun_all_starport_s01_u01.glb', axis: 'z', c: -49.48, from: 40.7, to: 43.6, lvl: 0.88, way: 1, what: 'a starport\'s steps' },
  ];
  for (const ln of lines) {
    const file = join(PACKS, 'gallery', ln.file);
    if (!existsSync(file)) {
      note(`no ${ln.file} at ${PACKS}: ${ln.what} is not walked here`);
      continue;
    }
    const P = readGlbTriangles(file).positions as Float32Array;
    const p = await Physics.create();
    const idx = new Uint32Array(P.length / 3).map((_, i) => i);
    const c = cleanTrimesh(P, idx)!;
    p.world.createCollider(RAPIER.ColliderDesc.trimesh(c.vertices, c.indices, TRIMESH_FLAGS));
    p.stepOnce();
    const s = new StairSense();
    const ray = new RAPIER.Ray({ x: 0, y: ln.lvl, z: 0 }, { x: 0, y: -1, z: 0 });
    let held = 0;
    let wrong = 0;
    let best = 0;
    for (let a = ln.from; a < ln.to; a += 0.02) {
      ray.origin.x = ln.axis === 'x' ? a : ln.c;
      ray.origin.z = ln.axis === 'x' ? ln.c : a;
      ray.origin.y = ln.lvl;
      const hit = p.world.castRay(ray, 3, true);
      if (!hit) continue;
      Object.assign(s.at, { x: ray.origin.x, y: ln.lvl - hit.timeOfImpact, z: ray.origin.z, vx: ln.axis === 'x' ? 1.2 : 0, vz: ln.axis === 'x' ? 0 : 1.2, dt: 1 / 60, filter: groups(Group.all, Group.all), reads: true });
      s.step(p.world, LOCO_TUNE.stairs);
      if (s.way === ln.way) held++;
      else if (s.way !== 0) wrong++;
      if (s.found.risers > best) best = s.found.risers;
    }
    ok(held > 0 && wrong === 0, `${ln.what} (${ln.file}): held ${ln.way > 0 ? 'up' : 'down'} over ${(held * 0.02).toFixed(2)} m of its ${(ln.to - ln.from).toFixed(1)} m, never the other way (${best} risers in one window at most)`);
    p.world.free();
  }
}

// ---- the stair clips' strides, measured off the rig ------------------------------------------------------------------------
{
  const body = speciesBodies(REPO).find((b) => b.id === 'human_male');
  if (!body) note('no converted human male here: the stair clips\' strides are held to the tune\'s numbers on its rig only where the packs are');
  else {
    const target = glbSkeleton(body.body);
    const packDir = join(REPO, 'public', 'anims', 'mixamo');
    const pack = new MixamoPack({
      enabled: () => true,
      index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
      clip: async (file: string) => {
        const b = readFileSync(join(packDir, file));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
      breath: async () => {},
      also: STAIR_IDS,
      now: () => performance.now(),
    });
    const info = console.info;
    console.info = () => {};
    const clips = await pack.clipsFor(target, 'human_male');
    console.info = info;
    // The skeleton as bones, played by a three mixer as the rig plays it.
    const group = new THREE.Group();
    const made: THREE.Bone[] = [];
    target.joints.forEach((j) => {
      const b = new THREE.Bone();
      b.name = j.name;
      b.position.fromArray(j.restP);
      b.quaternion.fromArray(j.restQ);
      made.push(b);
      (j.parent < 0 ? group : made[j.parent]).add(b);
    });
    const ankles = [made.find((b) => b.name === 'lAnkle')!, made.find((b) => b.name === 'rAnkle')!];
    const hips = made.find((b) => b.name === 'root')!;
    const strideOf = (id: string): { stride: number; climbLeft: number } => {
      const clip = clips.find((c) => c.name === `mx_${id}`)!;
      const mixer = new THREE.AnimationMixer(group);
      const action = mixer.clipAction(clip);
      action.play();
      const n = 240;
      const dt = clip.duration / n;
      const speeds: number[] = [];
      const last = [new THREE.Vector3(), new THREE.Vector3()];
      const now2 = new THREE.Vector3();
      let hipsLo = Infinity;
      let hipsHi = -Infinity;
      for (let i = 0; i <= n; i++) {
        mixer.setTime(i * dt);
        group.updateMatrixWorld(true);
        hips.getWorldPosition(now2);
        hipsLo = Math.min(hipsLo, now2.y);
        hipsHi = Math.max(hipsHi, now2.y);
        for (let s = 0; s < 2; s++) {
          ankles[s].getWorldPosition(now2);
          if (i > 0) {
            const vz = (now2.z - last[s].z) / dt;
            if (vz < -0.05) speeds.push(-vz);
          }
          last[s].copy(now2);
        }
      }
      speeds.sort((a, b) => a - b);
      return { stride: speeds[speeds.length >> 1], climbLeft: hipsHi - hipsLo };
    };
    const m = LOCO_TUNE_SHIPPED.made;
    const dials: Record<string, number> = { [STAIR_CLIPS.up[0]]: m.stairsUp, [STAIR_CLIPS.up[1]]: m.stairsRunUp, [STAIR_CLIPS.down[0]]: m.stairsDown, [STAIR_CLIPS.down[1]]: m.stairsRunDown };
    const speeds = LOCO_TUNE_SHIPPED.speed.forward;
    const measured = STAIR_IDS.map((id) => ({ id, ...strideOf(id) }));
    for (const { id, stride, climbLeft } of measured) {
      const walkClass = id === STAIR_CLIPS.up[0] || id === STAIR_CLIPS.down[0];
      const pace = walkClass ? speeds.walk : speeds.jog;
      note(`${id}: its feet go ${stride.toFixed(3)} m/s along the stairs on the human male (the tune's made ${dials[id]}); at the ${walkClass ? 'walk' : 'jog'}'s ${pace} m/s it needs a rate of ${(pace / stride).toFixed(2)} (the band holds it at ${LOCO_TUNE_SHIPPED.rate.max}), and at ${walkClass ? 'the walk' : 'the run'}'s ${walkClass ? pace : speeds.run} m/s, ${((walkClass ? pace : speeds.run) / stride).toFixed(2)}; a pace of ${((LOCO_TUNE_SHIPPED.rate.max * stride) / pace).toFixed(2)} of the class's would keep its feet on the treads; its hips rise and fall ${climbLeft.toFixed(2)} m over its loop`);
    }
    for (const { id, stride, climbLeft } of measured) {
      ok(Math.abs(stride - dials[id]) / dials[id] < 0.03, `${id}: the tune's made speed (${dials[id]}) is the stride measured off the rig within 3% (${stride.toFixed(3)})`);
      ok(climbLeft < 0.3, `${id}: its net climb is taken out (the hips rise and fall ${climbLeft.toFixed(2)} m over its loop, not the clip's ~0.49 m flight)`);
    }
  }
}

// ---- mutations of the rule ------------------------------------------------------------------------------------------------
{
  const SRC = readFileSync(join(REPO, 'src/anim/stairsRule.ts'), 'utf8').replace(/\r\n/g, '\n');
  const mutant = async (from: string, to: string): Promise<Rule> => {
    assert.ok(SRC.includes(from), `a mutation found nothing to change: ${from}`);
    const dir = mkdtempSync(join(tmpdir(), 'stairs-'));
    try {
      const f = join(dir, 'stairsRule.ts');
      writeFileSync(f, SRC.replace(from, to));
      return ((await import(pathToFileURL(f).href)) as { stairsIn: Rule }).stairsIn;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  ok(!ruleChecks(await mutant('run < tune.riserRun', 'run < 99')).notTerrace, 'mutation: a riser\'s run not held under riserRun: terraces are taken for stairs');
  ok(!ruleChecks(await mutant('rise <= tune.riserMax', 'rise <= 99')).walls, 'mutation: a riser\'s height not held under riserMax: a wall is taken for a riser');
  ok(!ruleChecks(await mutant('if (best >= count) {', 'if (best >= 1) {')).notKerb, 'mutation: one riser enough: a single kerb is stairs');
  ok(!ruleChecks(await mutant('rise >= tune.riserMin', 'rise >= 0')).bumps, 'mutation: the least riser not asked: bumps are stairs');
  ok(!ruleChecks(await mutant('(mid - lastMid) * step >= tune.treadMin', 'true')).notLedge, 'mutation: the least tread not asked: a kerb\'s lip is a tread');
  ok(!ruleChecks(await mutant('if (d <= level && d >= -level) {', 'if (d === 0) {')).slanted, 'mutation: a tread not let be level within `level`: stairs whose treads are not quite level are lost');
  ok(!ruleChecks(await mutant('      runSign = 0;\n      runRisers = 0;\n      levelSince = true;\n      k++;', '      k++;')).holes, 'mutation: ground not found does not end the run: stairs are read across a hole');
}

console.log(`stairsRule: ${checks} checks passed`);
