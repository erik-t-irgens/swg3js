// The flight of steps in Mos Eisley starport's arrivals hall (step 10b), climbed in a real physics world.
//
// The design put the arrivals' slow walk through that hall (its cell 7, `arrivals1`) down to its one
// climb: eight risers of about 0.15 m, the first step-up probe's own height being 0.1 m, so every riser
// would hold the body back, ask the probes and lift it -- and offered two ways to make it quicker, lifting
// onto the room's authored floor with no probe (A), or carrying the pace through the next riser (B), the
// one that climbs within 1.3 times the time the same walk takes on the flat to be taken, with the per-riser
// lift as the baseline.
//
// Measured here, a straight climb is not slow: every lift sets the body on the tread and carries it along to
// the spot the probe found, so a person walked straight up the flight -- a flight drawn here, and the hall's
// own triangles out of the starport's model -- reaches its top in about two thirds of the time the same walk
// takes on the flat, with one lift a riser, at every walking pace and thirty degrees either side.
//
// **That does not settle 10b, and neither option is built on it.** The game's own trace at Mos Eisley has
// arrivals spending 26 to 44 s on average in that hall, whose two doorways are 23 m apart, and making 15 to
// 18 lifts each over their whole walk: this straight climb, which leaves out the room's corners, the turn
// rate, the gait's ramp and the stuck check's side-steps, reproduces none of it, and the timing bound below
// could not tell the design's own guess from what it measures: with every other probe refused and waited
// out, the climb still came in at no more than 0.99 of the flat (0.93 up the hall's own flight) -- only the
// exact count of lifts told the two apart. What the hall's
// slow walk is made of is the next measurement: `__debug.ours({ trace: true })` now keeps each traveller's
// lifts by room (`meanLiftsByRoom`, cell 7), beside its seconds by room. This test holds what it can hold: a
// straight climb is one lift a riser and no slower than the flat, which fails the day the step-up regresses.
//
// Run: node tools/swg/tests/roomFlight.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXED_DT, Group, Physics, RAPIER, TRIMESH_FLAGS, cleanTrimesh, groups } from '../../../src/core/physics.ts';
import { planBody, type BodyInput } from '../../../src/world/mobiles/shape.ts';
import { STEP_STATS, STEP_TUNE, onFeet, stepHeightOf, stepWalker, stoodStill, walkStep, type StepRay, type StepShape } from '../../../src/world/mobiles/stepUp.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

await Physics.create();

/** A mobile's filter indoors (`mobile.ts`): everything but the terrain and the shells. */
const INSIDE = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));
/** A person, as the catalogue gives one (the same as `stepUp.test.ts`'s). */
const PERSON: BodyInput = { hierarchy: 'all_b', flags: [], bounds: { min: [-0.85, 0, -0.2], max: [0.85, 1.8, 0.2] }, collisionRadius: 0.5, collisionLength: 1.5, stepHeight: 0.5, swimHeight: 1, sizeClass: 'medium', scale: 1 };
/** The most a flight may take against the flat, as the design set it. */
const LIMIT = 1.3;

type Tri = [number, number, number][];

/** A physics world whose floor is the room's own group, holding `tris` (a room's triangles) or a slab at `floorY`. */
function world(tris: Tri[] | null, floorY: number): Physics {
  const physics = Physics.local();
  if (tris) {
    const v: number[] = [];
    const idx: number[] = [];
    for (const t of tris) {
      const base = v.length / 3;
      for (const p of t) v.push(p[0], p[1], p[2]);
      idx.push(base, base + 1, base + 2);
    }
    const clean = cleanTrimesh(new Float32Array(v), new Uint32Array(idx));
    assert.ok(clean, 'the room survives cleaning');
    physics.world.createCollider(RAPIER.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS).setCollisionGroups(groups(Group.interior, Group.all)));
  } else physics.world.createCollider(RAPIER.ColliderDesc.cuboid(300, 0.5, 300).setTranslation(0, floorY - 0.5, 0).setCollisionGroups(groups(Group.interior, Group.all)));
  physics.stepOnce();
  return physics;
}

/**
 * A person walked from `start` along the unit (`dx`, `dz`) at `speed`, driven exactly as `Mobile.act`
 * drives one (the ground ray, `onFeet`, `walkStep`, then its velocity along its heading), until it has
 * gone `run` metres along: the seconds that took, its lifts, and its feet's height at the end.
 */
function walk(physics: Physics, start: [number, number, number], dx: number, dz: number, speed: number, run: number, limit = 40): { t: number; lifts: number; y: number } {
  const plan = planBody(PERSON);
  const support = plan.colliders[0];
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(start[0], start[1] + plan.feet + 0.05, start[2]).lockRotations().setLinearDamping(0.6).setAngularDamping(2.5));
  for (const c of plan.colliders) {
    const desc = c.shape === 'ball' ? RAPIER.ColliderDesc.ball(c.radius) : RAPIER.ColliderDesc.capsule(c.half, c.radius);
    desc.setTranslation(c.at[0], c.at[1], c.at[2]).setMass(Math.max(0.5, c.mass)).setFriction(0.8).setCollisionGroups(INSIDE);
    physics.world.createCollider(desc, body);
  }
  for (let i = 0; i < 20; i++) physics.step(FIXED_DT);
  const hit: StepRay = { toi: 0, ny: 0 };
  const shape: StepShape = { along: support.at[2], rim: support.radius, step: stepHeightOf(PERSON.stepHeight, 1), feet: plan.feet };
  const w = stepWalker();
  let t = Infinity;
  for (let f = 0; f < Math.round(limit / FIXED_DT); f++) {
    const now = f * FIXED_DT;
    const p = body.translation();
    if ((p.x - start[0]) * dx + (p.z - start[2]) * dz >= run) {
      t = now;
      break;
    }
    const footY = p.y - plan.feet;
    const grounded = physics.groundDistance(p.x, p.y, p.z, plan.feet + 0.4, body, INSIDE) !== null;
    if (onFeet(w, grounded, footY)) {
      const v = body.linvel();
      const vy = walkStep(physics, body, w, now, grounded, speed, v.x, v.y, v.z, dx, dz, shape, p.x, footY, p.z, INSIDE, hit);
      body.setLinvel({ x: dx * speed, y: vy, z: dz * speed }, true);
    } else stoodStill(w);
    physics.step(FIXED_DT);
  }
  const y = body.translation().y - plan.feet;
  physics.removeBody(body);
  return { t, lifts: w.lifts, y };
}

ok(STEP_TUNE.low < 0.15 && STEP_TUNE.retry > 0, `the premise: a 0.15 m riser stands over the first probe's own ${STEP_TUNE.low} m, so each riser holds a body back and is climbed by a lift`);

// ---------------------------------------------------------------- a flight drawn here

/** Eight risers of `rise` over `tread`, from z 3 up toward +z, then a landing, all 3 m either side of x 0, as a building's triangles are. */
function flight(rise: number, tread: number): Tri[] {
  const tris: Tri[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    tris.push([a, b, c] as Tri, [a, c, d] as Tri);
  };
  for (let s = 0; s < 8; s++) {
    const y0 = s * rise;
    const y1 = (s + 1) * rise;
    const z = 3 + s * tread;
    quad([-3, y0, z], [-3, y1, z], [3, y1, z], [3, y0, z]);
    const deep = s === 7 ? 20 : tread;
    quad([-3, y1, z], [-3, y1, z + deep], [3, y1, z + deep], [3, y1, z]);
  }
  // The floor it rises from.
  quad([-30, 0, -30], [-30, 0, 3], [30, 0, 3], [30, 0, -30]);
  return tris;
}
{
  const rows: string[] = [];
  let worst = 0;
  let allUp = true;
  for (const tread of [0.3, 0.35, 0.4]) {
    for (const speed of [1.0, 1.3, 1.8]) {
      const run = 3 + 8 * tread + 1;
      const flat = walk(world(null, 0), [0, 0, 0], 0, 1, speed, run);
      const up = walk(world(flight(0.15, tread), 0), [0, 0, 0], 0, 1, speed, run);
      const k = up.t / flat.t;
      worst = Math.max(worst, k);
      if (!(Math.abs(up.y - 1.2) < 0.05) || up.lifts !== 8) allUp = false;
      rows.push(`${tread} m at ${speed} m/s ${k.toFixed(2)}x`);
    }
  }
  ok(allUp, 'a person walks up eight 0.15 m risers over treads of 0.3 to 0.4 m with a lift a riser, and on across the top');
  ok(worst <= LIMIT, `... within ${LIMIT} times the flat walk at every tread and pace (the worst ${worst.toFixed(2)}x: ${rows.join(', ')}): each lift sets the body on its tread and carries it along, so the flight is no slower than the flat`);
}

// ---------------------------------------------------------------- the hall's own flight

const glb = join(process.cwd(), 'assets-private', 'tatooine', 'mun_tato_starport_s01_u01.glb');
if (!existsSync(glb)) note("Tatooine's starport is not converted, so its arrivals hall is not climbed: npm run swg -- snapshot @SWG tatooine assets-private --retail-only");
else {
  // The room's triangles, out of the model's own `cell:7:` node and everything under it (translations only, as the converter writes them).
  const buf = readFileSync(glb);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    nodes: { name?: string; mesh?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
    meshes: { primitives: { attributes: { POSITION: number }; indices?: number }[] }[];
    accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
  };
  const bin = buf.subarray(20 + jsonLen + 8);
  const read = (i: number): number[] => {
    const a = json.accessors[i];
    const v = json.bufferViews[a.bufferView];
    const n = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type];
    const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out: number[] = [];
    for (let k = 0; k < a.count; k++)
      for (let c = 0; c < n; c++) {
        if (a.componentType === 5126) out.push(bin.readFloatLE(base + (v.byteStride ? k * v.byteStride : k * n * 4) + c * 4));
        else if (a.componentType === 5125) out.push(bin.readUInt32LE(base + k * 4));
        else out.push(bin.readUInt16LE(base + k * 2));
      }
    return out;
  };
  const tris: Tri[] = [];
  let turned = false;
  const visit = (ni: number, at: number[]): void => {
    const n = json.nodes[ni];
    if (n.rotation || n.scale || n.matrix) turned = true;
    const t = n.translation ?? [0, 0, 0];
    const here = [at[0] + t[0], at[1] + t[1], at[2] + t[2]];
    if (n.mesh !== undefined)
      for (const p of json.meshes[n.mesh].primitives) {
        const pos = read(p.attributes.POSITION);
        const idx = p.indices !== undefined ? read(p.indices) : [...Array(pos.length / 3).keys()];
        for (let i = 0; i < idx.length; i += 3) tris.push([idx[i], idx[i + 1], idx[i + 2]].map((k) => [pos[k * 3] + here[0], pos[k * 3 + 1] + here[1], pos[k * 3 + 2] + here[2]]) as Tri);
      }
    for (const c of n.children ?? []) visit(c, here);
  };
  const cell = json.nodes.findIndex((n) => /^cell:7:/.test(n.name ?? ''));
  if (cell >= 0) visit(cell, [0, 0, 0]);
  // The treads, as the model has them: every level surface between the hall's two floors, by height.
  const treads = new Map<string, { area: number; x: number; z: number; n: number }>();
  for (const [a, b, c] of tris) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    const y = (a[1] + b[1] + c[1]) / 3;
    if (Math.abs(ny / len) < 0.95 || y < -0.45 || y > 0.55) continue;
    const key = y.toFixed(2);
    const s = treads.get(key) ?? { area: 0, x: 0, z: 0, n: 0 };
    s.area += len / 2;
    s.x += (a[0] + b[0] + c[0]) / 3;
    s.z += (a[2] + b[2] + c[2]) / 3;
    s.n++;
    treads.set(key, s);
  }
  const steps = [...treads.entries()].sort((p, q) => Number(p[0]) - Number(q[0])).map(([y, s]) => ({ y: Number(y), x: s.x / s.n, z: s.z / s.n, area: s.area }));
  if (cell < 0 || turned || steps.length !== 7) note(`the hall's flight is not what was measured (${cell < 0 ? 'no cell 7' : turned ? 'a node is turned' : `${steps.length} treads between its floors`}), so it is not climbed`);
  else {
    // Seven treads between the two floors (-0.52 and 0.64) make eight risers; the way up is along the
    // line through the treads' middles.
    const first = steps[0];
    const last = steps[steps.length - 1];
    const along = Math.hypot(last.x - first.x, last.z - first.z);
    const dx = (last.x - first.x) / along;
    const dz = (last.z - first.z) / along;
    const rise = (last.y - first.y) / (steps.length - 1);
    const tread = along / (steps.length - 1);
    ok(Math.abs(rise - 0.145) < 0.01 && tread > 0.25 && tread < 0.4 && steps.every((s) => Math.abs(s.area - 2.1) < 0.2), `the hall's flight is as measured: eight risers of ${rise.toFixed(3)} m over treads ${tread.toFixed(2)} m deep, each ${first.area.toFixed(1)} m² (from the model's own triangles)`);
    const rows: string[] = [];
    let worst = 0;
    let allUp = true;
    const mid = [(first.x + last.x) / 2, (first.z + last.z) / 2];
    for (const turn of [0, 30, -30]) {
      const a = (turn * Math.PI) / 180;
      const hx = dx * Math.cos(a) - dz * Math.sin(a);
      const hz = dx * Math.sin(a) + dz * Math.cos(a);
      const start: [number, number, number] = [mid[0] - hx * 3.6, -0.52, mid[1] - hz * 3.6];
      for (const speed of [1.0, 1.3, 1.8]) {
        const flat = walk(world(null, -0.52), start, hx, hz, speed, 7.2);
        const up = walk(world(tris, -0.52), start, hx, hz, speed, 7.2);
        const k = up.t / flat.t;
        worst = Math.max(worst, k);
        if (!(Math.abs(up.y - 0.64) < 0.08)) allUp = false;
        rows.push(`${turn}° at ${speed} m/s ${k.toFixed(2)}x, ${up.lifts} lifts`);
      }
    }
    ok(allUp, 'a person walks up the hall\'s own flight onto its upper floor, straight at it and thirty degrees either side');
    ok(worst <= LIMIT, `... within ${LIMIT} times the flat walk (the worst ${worst.toFixed(2)}x: ${rows.join('; ')}): a straight climb of the hall's flight is not slow in itself -- which is not what the arrivals' walk through the hall measures in the game, so 10b is undecided`);
    note(`asked ${STEP_STATS.asked}, lifted ${STEP_STATS.lifted} over every walk here`);
  }
}

console.log(`\nroom flight: ${passed} checks passed`);
