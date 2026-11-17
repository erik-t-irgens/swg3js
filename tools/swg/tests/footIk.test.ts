// Wave 3 of the animations, item A: both feet placed on what is under them (src/player/footIk.ts, the owner's brief's
// line 19), on the real Rapier, over a skeleton the game draws (the converted human male's where the packs are here, else
// the tests' own), posed by its rest pose or by the very clips the pack fits for it (`MixamoPack.clipsFor`):
//  - on flat ground the placement moves nothing a clip had right; on faces of 20, 35 and 50 degrees, terrain and
//    trimesh, faced up and across, every planted foot's sole meets the ground (the lower of its two sole points on it
//    within a centimetre, neither under it), turned to the slope within `pitchMost` and `rollMost`;
//  - a step beside the body of 0.15, 0.25 and 0.4 m: the lower foot reached by lowering the pelvis, by no more than
//    `pelvisMost`, the higher leg bent; a riser past that, the lower foot left short of the ground and never under it;
//  - up and down staircases of risers 0.15, 0.25 and 0.4 m with the stair clips at a walk's and a run's pace, at 60 and
//    144 frames a second: every planted foot's sole on its tread, less what of a sudden change of it is still being let in
//    over the ease (which settles within half a second);
//  - a planted foot slid off a step's edge: each ankle and the pelvis move by no more a frame than an ease of the riser
//    gives, at 30, 60 and 144 frames a second (the review's "pop by a riser in a frame");
//  - walking up slopes and onto and off kerbs by the game's movement with the walk clip: no knee ever backward, none off
//    the clip's own leg plane past its ankle, the pelvis's drop no faster than an ease; walking down a flight, a foot not
//    planted keeps the clip's own leg carried down with the pelvis (never an ankle over a dropped hip);
//  - at a cliff's edge the foot over the air drawn in onto the edge (`edgePull`), and with none, left where its clip has it;
//  - aboard a ship's rooms (their own physics, a hull turned and moved in the world): the same, in the rooms' frame;
//  - the placement and the pelvis eased in and out alike at 30, 60 and 144 frames a second (sampled every sixth of a second);
//  - standing still casts no ray after the first, nor with an idle swaying the feet after its first sway; the clip's pose
//    put back whole by `restore`; under 'before' nothing is written to a bone or the root and nothing is cast (the clip's
//    pose to the bit);
//  - the game's hand-overs as text: the rig's hook before its mixer, the player's and the peers' passes.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';

const charStub = 'export class Character { static async load() { throw new Error("no pack in a test"); } }';
const hook = `import { existsSync } from 'node:fs';
export async function resolve(s, c, next) {
  if (s === './character' || s === './character.ts' || s.endsWith('/player/character') || s.endsWith('/player/character.ts')) {
    return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(charStub)}), shortCircuit: true };
  }
  if (s.startsWith('.') && !/\\.[a-z]+$/.test(s) && c.parentURL && existsSync(new URL(s + '.ts', c.parentURL))) return next(s + '.ts', c);
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { Physics, RAPIER, TRIMESH_FLAGS, cleanTrimesh, Group, groups } = await import('../../../src/core/physics.ts');
const { FootIk } = await import('../../../src/player/footIk.ts');
const { LOCO_TUNE, LOCO_TUNE_SHIPPED } = await import('../../../src/anim/locoTune.ts');
const { STAIR_CLIPS, STAIR_IDS } = await import('../../../src/anim/locoTable.ts');
const { MixamoPack } = await import('../../../src/anim/mixamoPack.ts');
const { glbSkeleton, speciesBodies, targetSkeleton } = await import('./animFixtures.ts');
const { REPO } = await import('./oldModules.ts');
type Phys = Awaited<ReturnType<typeof Physics.create>>;
type Target = ReturnType<typeof targetSkeleton>;
type Feet = InstanceType<typeof FootIk>;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const DEG = Math.PI / 180;
const ALL = groups(Group.all, Group.all);

const body = speciesBodies(REPO).find((b) => b.id === 'human_male');
const target: Target = body ? (glbSkeleton(body.body) as Target) : targetSkeleton();
note(body ? 'the converted human male\'s skeleton' : 'no converted human male here: the tests\' own skeleton');

// ---- the figure: the skeleton as bones under a root, as the game's rig holds them ------------------------------------------
interface Figure {
  root: THREE.Group;
  bones: Map<string, THREE.Bone>;
  rig: { root: THREE.Group; boneNamed(n: string): THREE.Bone | null; restSkeleton(): Target; legPose: { restore(): void } | null };
  mixer: THREE.AnimationMixer;
}
function figure(parent?: THREE.Object3D): Figure {
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
  parent?.add(root);
  const rig = { root, boneNamed: (n: string) => bones.get(n) ?? null, restSkeleton: () => target, legPose: null as { restore(): void } | null };
  return { root, bones, rig, mixer: new THREE.AnimationMixer(root) };
}
// Wave 3's own pelvis rule, which the stairs wave keeps as `ik.hips` 'before': the hips held steady (its start) are held
// to these same checks, and their own, by `hipsSteady.test.ts`.
const tuneNow = () => ({ ...(JSON.parse(JSON.stringify(LOCO_TUNE_SHIPPED.ik)) as typeof LOCO_TUNE.ik), hips: 'before' as const });

// ---- the worlds ---------------------------------------------------------------------------------------------------------
function trimesh(p: Phys, v: number[], idx: number[]): void {
  const c = cleanTrimesh(new Float32Array(v), new Uint32Array(idx))!;
  const d = RAPIER.ColliderDesc.trimesh(c.vertices, c.indices, TRIMESH_FLAGS);
  d.setCollisionGroups(groups(Group.exterior, Group.all));
  p.world.createCollider(d);
}
function box(p: Phys, min: number[], max: number[]): void {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  trimesh(p, [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
}
function flat(p: Phys, y = 0): void {
  const c = p.world.createCollider(RAPIER.ColliderDesc.cuboid(200, 1, 200).setTranslation(0, y - 1, 0));
  c.setCollisionGroups(groups(Group.terrain, Group.all));
}
/** A face rising at `deg` along +x through the origin: a trimesh plane, or the terrain's own heightfield. */
function slope(p: Phys, kind: 'trimesh' | 'terrain', deg: number): (x: number, z: number) => number {
  const t = Math.tan(deg * DEG);
  const h = (x: number) => x * t;
  if (kind === 'trimesh') trimesh(p, [-20, h(-20), -20, 20, h(20), -20, 20, h(20), 20, -20, h(-20), 20], [0, 2, 1, 0, 3, 2]);
  else {
    const size = 64;
    const res = 32;
    const heights = new Float32Array((res + 1) * (res + 1));
    for (let xi = 0; xi <= res; xi++) for (let zi = 0; zi <= res; zi++) heights[xi * (res + 1) + zi] = h(-32 + (xi * size) / res);
    p.createHeightfield(-32, -32, size, res, heights);
  }
  return (x) => h(x);
}

// ---- a frame: pose, place, step, measure -------------------------------------------------------------------------------
const tmp = new THREE.Vector3();
const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
/** The ground under a point, in the physics frame: the topmost still surface within two metres. */
function groundUnder(world: Phys['world'], x: number, y: number, z: number): number {
  ray.origin.x = x;
  ray.origin.y = y + 1;
  ray.origin.z = z;
  const hit = world.castRay(ray, 3, true);
  return hit ? ray.origin.y - hit.timeOfImpact : Number.NaN;
}
interface LegSay { planted: number; clip: number; grounded: boolean; liftM: number; easingM: number; pullM: number; pitchDeg: number; rollDeg: number }
/** The share of a sudden change of a planted foot's ground still being let in (`ik.ease`), past which its sole is not yet on that ground. */
const EASING = 0.01;
interface Read { gaps: number[][]; legs: LegSay[]; drop: number }
/** Each leg's sole points' heights over the ground under them (heel, ball, the toe's tip), in the physics frame. */
function read(feet: Feet, world: Phys['world'], toPhys: THREE.Matrix4 | null): Read {
  const gaps: number[][] = [];
  for (let s = 0; s < 2; s++) {
    const g: number[] = [];
    for (let w = 0; w < 3; w++) {
      const v = feet.solePoint(s, w, toPhys, tmp);
      if (v) g.push(v.y - groundUnder(world, v.x, v.y, v.z));
    }
    gaps.push(g);
  }
  const rep = feet.report() as { legs: LegSay[]; dropM: number };
  return { gaps, legs: rep.legs, drop: feet.drop };
}
interface Place { x: number; y: number; z: number; heading: number; /** The capsule's feet, where the drawn root stands off them (the stairs' ease); else the root's. */ py?: number }
/** One frame: the clip stepped (if any), the figure placed, the feet stepped, the matrices worked out. */
function frame(f: Figure, feet: Feet, world: Phys['world'] | null, at: Place, dt: number, stairClip: boolean, toPhys: THREE.Matrix4 | null, on = true): void {
  f.rig.legPose?.restore();
  f.mixer.update(dt);
  f.root.position.set(at.x, at.y, at.z);
  f.root.rotation.set(0, at.heading, 0);
  f.root.updateMatrixWorld(true);
  const fi = feet.in;
  fi.dt = dt;
  fi.on = on;
  fi.stairClip = stairClip;
  fi.px = at.x;
  fi.py = at.py ?? at.y;
  fi.pz = at.z;
  fi.heading = at.heading;
  fi.filter = ALL;
  feet.step(f.rig as never, world, toPhys);
  f.root.updateMatrixWorld(true);
}
/** Whether a planted foot is on its ground: the lowest of its sole points within `tol` of it, none under it by more. */
const onGround = (g: number[], tol = 0.01) => Math.min(...g) <= tol && Math.min(...g) >= -tol;
const makeRay = () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
/**
 * How deep a point stands inside a staircase given by its profile along x: its distance to the nearest point outside it
 * (up, back, ahead, or a corner's diagonal), a millimetre at a time within 0.4 m. A point a millimetre past a riser's face
 * and a centimetre under the tread below it is a centimetre in, not a riser.
 */
function depthIn(groundAt: (x: number) => number, x: number, y: number): number {
  if (y >= groundAt(x)) return 0;
  let best = groundAt(x) - y;
  for (let k = 1; k <= 400 && k * 0.001 < best; k++) {
    for (const s of [-1, 1]) {
      const up = groundAt(x + s * k * 0.001) - y;
      const d = Math.sqrt(k * 0.001 * (k * 0.001) + (up > 0 ? up * up : 0));
      if (d < best) best = d;
    }
  }
  return best;
}

// ---- flat ground: the rest pose's feet stand where they were ---------------------------------------------------------------
{
  const p = await Physics.create();
  flat(p);
  p.stepOnce();
  const f = figure();
  const feet = new FootIk(tuneNow(), makeRay);
  const at = { x: 0, y: 0, z: 0, heading: 0.4 };
  frame(f, feet, p.world, at, 1 / 60, false, null);
  const first = feet.casts;
  for (let i = 0; i < 119; i++) frame(f, feet, p.world, at, 1 / 60, false, null);
  const r = read(feet, p.world, null);
  ok(r.legs.every((l) => l.planted > 0.99 && l.grounded) && r.gaps.every((g) => onGround(g, 0.005)) && r.drop < 0.005, `on flat ground the rest pose's soles stand on it as they were (gaps ${r.gaps.flat().map((v) => v.toFixed(4)).join(', ')} m, the pelvis lowered ${r.drop.toFixed(4)} m)`);
  ok(first === 4 && feet.casts === first && feet.reused >= 119 * 4, `standing still the feet cast their four rays once and none after (${feet.casts} over 120 frames, ${feet.reused} read back)`);
  p.world.free();
}

// ---- standing with an idle that sways the feet ---------------------------------------------------------------------------------
// The game's idle rocks the feet a little (a heel's ray moves past the half centimetre a kept answer stands for): each slot
// keeps its last few answers, so after the first sway every place is read back and nothing more is cast.
async function swayStand(Cls: typeof FootIk): Promise<{ first: number; after: number }> {
  const p = await Physics.create();
  flat(p);
  p.stepOnce();
  const f = figure();
  const feet = new Cls(tuneNow(), makeRay);
  const ankles = ['lAnkle', 'rAnkle'].map((n) => f.bones.get(n)!);
  const rest = ankles.map((b) => b.quaternion.clone());
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3(1, 0, 0);
  const fps = 60;
  let first = 0;
  for (let i = 0; i < 20 * fps; i++) {
    f.rig.legPose?.restore();
    // A two-second sway of each ankle, four degrees either way (a heel's point moves about a centimetre).
    ankles.forEach((b, s) => b.quaternion.copy(rest[s]).multiply(q.setFromAxisAngle(axis, Math.sin(Math.PI * (i / fps) + s) * 4 * DEG)));
    f.root.position.set(0, 0, 0);
    f.root.rotation.set(0, 0.4, 0);
    f.root.updateMatrixWorld(true);
    const fi = feet.in;
    fi.dt = 1 / fps;
    fi.on = true;
    fi.stairClip = false;
    fi.px = 0;
    fi.py = 0;
    fi.pz = 0;
    fi.heading = 0.4;
    fi.filter = ALL;
    feet.step(f.rig as never, p.world, null);
    if (i === 2 * fps) first = feet.casts;
  }
  p.world.free();
  return { first, after: feet.casts - first };
}
{
  const s = await swayStand(FootIk);
  ok(s.first > 4 && s.after === 0, `standing with an idle that sways the feet a centimetre: ${s.first} rays over its first sway, and none over the eighteen seconds after (each slot reads its kept answers back)`);
}

// ---- faces of 20, 35 and 50 degrees ---------------------------------------------------------------------------------------
{
  const tune = tuneNow();
  for (const kind of ['trimesh', 'terrain'] as const) {
    for (const deg of [20, 35, 50]) {
      for (const facing of ['up', 'across'] as const) {
        const p = await Physics.create();
        const h = slope(p, kind, deg);
        p.stepOnce();
        const f = figure();
        const feet = new FootIk(tune, makeRay);
        // Up the slope: the figure's front along +x (heading pi/2); across: along +z.
        const heading = facing === 'up' ? Math.PI / 2 : 0;
        const at = { x: 0.3, y: h(0.3, 0), z: 0.2, heading };
        for (let i = 0; i < 90; i++) frame(f, feet, p.world, at, 1 / 60, false, null);
        const r = read(feet, p.world, null);
        const planted = r.legs.every((l) => l.planted > 0.99 && l.grounded);
        const turned = r.legs.every((l) => Math.abs(l.pitchDeg) <= tune.pitchMost + 1e-6 && Math.abs(l.rollDeg) <= tune.rollMost + 1e-6);
        const want = facing === 'up' ? Math.min(deg, tune.pitchMost) : Math.min(deg, tune.rollMost);
        const angle = facing === 'up' ? r.legs.map((l) => Math.abs(l.pitchDeg)) : r.legs.map((l) => Math.abs(l.rollDeg));
        ok(planted && turned && r.gaps.every((g) => onGround(g)) && angle.every((a) => Math.abs(a - want) < 0.6) && r.drop <= tune.pelvisMost + 1e-9, `a ${deg} degree ${kind} face, faced ${facing}: each sole on it (gaps ${r.gaps.flat().map((v) => v.toFixed(3)).join(', ')} m), each foot turned ${angle.map((a) => a.toFixed(1)).join(' and ')} degrees (${want} wanted, held to the dials), the pelvis lowered ${r.drop.toFixed(3)} m`);
        p.world.free();
      }
    }
  }
}

// ---- a step beside the body -----------------------------------------------------------------------------------------------
{
  const tune = tuneNow();
  for (const riser of [0.15, 0.25, 0.4, 0.55, 0.75]) {
    const p = await Physics.create();
    flat(p);
    box(p, [0, 0, -5], [5, riser, 5]);
    p.stepOnce();
    const f = figure();
    const feet = new FootIk(tune, makeRay);
    // Facing +z (its left hand at +x): the left foot over the step, the right on the floor; the capsule stands on the step's edge, its middle 5 cm onto it.
    const at = { x: 0.05, y: riser, z: 0, heading: 0 };
    for (let i = 0; i < 90; i++) frame(f, feet, p.world, at, 1 / 60, false, null);
    const r = read(feet, p.world, null);
    if (riser <= tune.pelvisMost) ok(r.gaps.every((g) => onGround(g)) && Math.abs(r.drop - riser) < 0.01, `a ${riser} m step beside the body: both soles on their ground (gaps ${r.gaps.flat().map((v) => v.toFixed(3)).join(', ')} m), the pelvis lowered ${r.drop.toFixed(3)} m to the lower foot`);
    else if (riser < tune.pelvisMost + 0.25) ok(Math.abs(r.drop - tune.pelvisMost) < 1e-9 && r.gaps.every((g) => Math.min(...g) >= -0.01), `a ${riser} m step, past the pelvis's most: lowered ${r.drop.toFixed(3)} m and no more, the lower leg straightened the rest of the way (its sole ${Math.min(...r.gaps[0]).toFixed(3)} m over its ground) and no sole under it`);
    else ok(r.legs[1].pullM > 0 && r.drop < 0.01 && r.gaps.every((g) => onGround(g)), `a ${riser} m drop beside the body, the floor out of the pelvis's reach: the foot over it is drawn ${r.legs[1].pullM.toFixed(2)} m in onto the step's edge, as at a cliff, and the pelvis not lowered`);
    p.world.free();
  }
}

// ---- a drawn body held over the capsule (going down a flight) -------------------------------------------------------------
{
  const tune = tuneNow();
  const p = await Physics.create();
  flat(p);
  box(p, [0, 0, -5], [5, 0.4, 5]);
  p.stepOnce();
  const f = figure();
  const feet = new FootIk(tune, makeRay);
  // The capsule on a 0.4 m step beside the floor, the drawn body 0.5 m over it (the stairs' ease at its most, going down).
  const at = { x: 0.05, y: 0.9, z: 0, heading: 0, py: 0.4 };
  for (let i = 0; i < 90; i++) frame(f, feet, p.world, at, 1 / 60, false, null);
  const r = read(feet, p.world, null);
  ok(r.gaps.every((g) => onGround(g)) && Math.abs(r.drop - 0.9) < 0.01, `a drawn body held 0.5 m over a capsule on a 0.4 m step: the pelvis comes down ${r.drop.toFixed(3)} m, past \`pelvisMost\` by the hold and no further, and both soles stand on their ground (gaps ${r.gaps.flat().map((v) => v.toFixed(3)).join(', ')} m)`);
  p.world.free();
}
// ---- the clips the game plays: up and down staircases --------------------------------------------------------------------
const packDir = join(REPO, 'public', 'anims', 'mixamo');
const pack = new MixamoPack({
  enabled: () => true,
  index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
  clip: async (file: string) => {
    const b = readFileSync(join(packDir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
  breath: async () => {},
  also: [...STAIR_IDS, 'walking'],
  now: () => performance.now(),
});
const info = console.info;
console.info = () => {};
const clips = await pack.clipsFor(target as never, 'feet');
console.info = info;
const clipOf = (id: string) => clips.find((c) => c.name === `mx_${id}`)!;
/** A world: flat ground, a flight up from x = 2, a 2 m landing, a flight down. */
async function stairsWorld(riser: number, tread: number, n: number): Promise<{ p: Phys; groundAt: (x: number) => number; land: number; end: number }> {
  const p = await Physics.create();
  flat(p);
  for (let i = 0; i < n; i++) box(p, [2 + i * tread, 0, -2], [2 + (i + 1) * tread, (i + 1) * riser, 2]);
  const land = 2 + n * tread;
  box(p, [land, 0, -2], [land + 2, n * riser, 2]);
  for (let i = 0; i < n - 1; i++) box(p, [land + 2 + i * tread, 0, -2], [land + 2 + (i + 1) * tread, (n - i - 1) * riser, 2]);
  p.stepOnce();
  const end = land + 2 + n * tread;
  const groundAt = (x: number) => (x < 2 ? 0 : x < land ? Math.min(n, Math.floor((x - 2) / tread) + 1) * riser : x < land + 2 ? n * riser : x < end ? Math.max(0, n - 1 - Math.floor((x - land - 2) / tread)) * riser : 0);
  return { p, groundAt, land, end };
}
/** A walk up a staircase and down the far flight with the stair clips, measured against the staircase's own profile. */
async function stairWalk(Cls: typeof FootIk, tune: typeof LOCO_TUNE.ik, riser: number, ids: string[], speed: number, fps: number): Promise<{ planted: number; under: number; easing: number; longest: number; deepRaw: number; worst: number; worstAt: string; casts: number; frames: number; metres: number }> {
  const made = LOCO_TUNE_SHIPPED.made;
  const tread = 0.3;
  const n = 5;
  const { p, groundAt, land, end } = await stairsWorld(riser, tread, n);
  const f = figure();
  const feet = new Cls(tune, makeRay);
  let worst = 0;
  let worstAt = '';
  let planted = 0;
  let under = 0;
  let easing = 0;
  let longest = 0;
  let deepRaw = 0;
  const run = [0, 0];
  let frames = 0;
  const dt = 1 / fps;
  let action: THREE.AnimationAction | null = null;
  let playing = '';
  for (let x = 0; x < end + 1; x += speed * dt) {
    frames++;
    // The clip for the flight under the body: up to the landing's middle, down after it.
    const id = x < land + 1 ? ids[0] : ids[1];
    if (id !== playing) {
      action?.stop();
      action = f.mixer.clipAction(clipOf(id));
      const m = id === STAIR_CLIPS.up[0] ? made.stairsUp : id === STAIR_CLIPS.up[1] ? made.stairsRunUp : id === STAIR_CLIPS.down[0] ? made.stairsDown : made.stairsRunDown;
      action.timeScale = speed / m;
      action.play();
      playing = id;
    }
    frame(f, feet as never, p.world, { x, y: groundAt(x), z: 0, heading: Math.PI / 2 }, dt, true, null);
    // Counted once the placement is in whole (it eases in over its first tenths of a second).
    if (feet.weight < 0.99) continue;
    const rep = feet.report() as { legs: LegSay[] };
    for (let s = 0; s < 2; s++) {
      const l = rep.legs[s];
      // A change of the ground under a foot still being let in (`ik.ease`): counted, and how long the longest lasts.
      run[s] = Math.abs(l.easingM) > EASING ? run[s] + 1 : 0;
      if (run[s] * dt > longest) longest = run[s] * dt;
      if (l.planted < 0.99 || !l.grounded) continue;
      planted++;
      // A sole stands where it is put less what of a sudden change of its ground is still being let in.
      const slack = Math.abs(l.easingM);
      if (slack > EASING) easing++;
      // Each sole point against the staircase's own profile: its height over the tread under it, and how deep it stands
      // inside a step (the lesser of how far under the tread and how far past the riser's face, within half a
      // centimetre), since a ray down at a point a millimetre past a riser's face reads the whole riser.
      let deepest = 0;
      let touching = false;
      const said: string[] = [];
      for (let w = 0; w < 3; w++) {
        const v = feet.solePoint(s, w, null, tmp);
        if (!v) continue;
        const g = v.y - groundAt(v.x);
        const d = g < 0 ? depthIn(groundAt, v.x, v.y) : 0;
        if (d > deepest) deepest = d;
        if (Math.abs(g) <= 0.01 + slack || (g < 0 && d <= 0.01 + slack)) touching = true;
        said.push(`${g.toFixed(3)}${d > 0 ? ` (${(d * 1000).toFixed(0)} mm in)` : ''}`);
      }
      const off = deepest > 0.01 + slack || !touching;
      const score = touching ? Math.max(0, deepest - slack) : Math.max(deepest, 1);
      if (deepest > deepRaw) deepRaw = deepest;
      if (score > worst) {
        worst = score;
        worstAt = `at x ${x.toFixed(3)} (${x < land + 1 ? 'up' : 'down'}), the ${s ? 'right' : 'left'} foot, its points ${said.join('/')}, lift ${l.liftM}, easing ${l.easingM}, pull ${l.pullM}, drop ${feet.drop.toFixed(3)}`;
      }
      if (off) under++;
    }
  }
  p.world.free();
  return { planted, under, easing, longest, deepRaw, worst, worstAt, casts: feet.casts, frames, metres: end + 1 };
}
const WALK = [STAIR_CLIPS.up[0], STAIR_CLIPS.down[0]];
const RUN = [STAIR_CLIPS.up[1], STAIR_CLIPS.down[1]];
{
  const tune = tuneNow();
  const rows: string[] = [];
  let allOn = true;
  let plantedFrames = 0;
  let easingFrames = 0;
  let longest = 0;
  let cast = '';
  for (const riser of [0.15, 0.25, 0.4]) {
    for (const [ids, speed] of [[WALK, 0.5], [RUN, 1.0]] as [string[], number][]) {
      for (const fps of [60, 144]) {
        const w = await stairWalk(FootIk, tune, riser, ids, speed, fps);
        plantedFrames += w.planted;
        easingFrames += w.easing;
        longest = Math.max(longest, w.longest);
        if (w.under > 0) allOn = false;
        if (riser === 0.25 && speed === 0.5 && fps === 60) cast = `${(w.casts / w.metres).toFixed(1)} rays a metre, ${(w.casts / w.frames).toFixed(2)} a frame at 60 frames a second`;
        rows.push(`risers of ${riser} m with ${ids.join(' and ')} at ${speed} m/s and ${fps} fps: ${w.planted} planted foot-frames (${w.easing} of them still letting a change of their ground in by more than a centimetre), the deepest any sole point stands in a step past what is still being let in ${(w.worst * 1000).toFixed(1)} mm (${w.worstAt || 'none'}), ${w.under} off their tread or in a step by more than a centimetre and that`);
      }
    }
  }
  for (const r of rows) note(r);
  ok(allOn && plantedFrames > 1000 && easingFrames < plantedFrames * 0.1, `up and down staircases of risers 0.15, 0.25 and 0.4 m, the stair clips at a walk's and a run's pace, at 60 and 144 frames a second: every planted foot's sole on its tread within a centimetre of where it is put (its ground, less what of a sudden change of it is still being let in over the ease), none in a step past that (${plantedFrames} foot-frames, ${easingFrames} of them letting a change in)`);
  ok(longest < 0.5, `and every such change is let in within half a second (the longest ${longest.toFixed(3)} s): the ease settles`);
  note(`walking up and down the 0.25 m staircase the feet cast ${cast} (a planted foot's place held within half a centimetre casts none; a swinging foot none)`);
}
// ---- walked by the game's own movement --------------------------------------------------------------------------------------
// The grapple's harness steps the game's movement (its controller, its autostep and its snap, wave 2b's slope rule): the
// figure stands where the capsule's feet are each frame, the stair clip played at the rate the body's own speed asks,
// held to the playback band (the feet slide where it is held, as in the game), and every planted sole is held to the
// staircase's own profile.
{
  const H = await import('./grappleBody.ts');
  const tune = tuneNow();
  const band = LOCO_TUNE_SHIPPED.rate;
  const rows: string[] = [];
  let allOn = true;
  let total = 0;
  for (const riser of [0.15, 0.25, 0.4]) {
    for (const walkKey of [true, false]) {
      for (const fps of [60, 144]) {
        const p = await H.makePhysics();
        H.ground(p, 0);
        const n = 5;
        const tread = 0.3;
        for (let i = 0; i < n; i++) H.box(p, [2 + i * tread, 0, -2], [2 + (i + 1) * tread, (i + 1) * riser, 2]);
        H.box(p, [2 + n * tread, 0, -2], [2 + n * tread + 3, n * riser, 2]);
        p.stepOnce();
        const groundAt = (x: number) => (x < 2 ? 0 : x < 2 + n * tread ? Math.min(n, Math.floor((x - 2) / tread) + 1) * riser : x < 2 + n * tread + 3 ? n * riser : 0);
        const b = new H.TestBody(p);
        b.forward.set(1, 0, 0);
        b.right.set(0, 0, 1);
        b.place(0, 0.02, 0);
        b.key('KeyW', true);
        if (walkKey) b.key('ShiftLeft', true);
        const f = figure();
        const feet = new FootIk(tune, makeRay);
        const id = walkKey ? STAIR_CLIPS.up[0] : STAIR_CLIPS.up[1];
        const made = walkKey ? LOCO_TUNE_SHIPPED.made.stairsUp : LOCO_TUNE_SHIPPED.made.stairsRunUp;
        const action = f.mixer.clipAction(clipOf(id));
        action.play();
        const dt = 1 / fps;
        let planted = 0;
        let under = 0;
        let short = 0;
        let easing = 0;
        let worst = 0;
        let worstAt = '';
        let top = 0;
        for (let i = 0; i < 6 * fps && b.pos.x < 2 + n * tread + 1.5; i++) {
          b.frame(dt);
          const sp = Math.hypot(b.vel.x, b.vel.z);
          action.timeScale = Math.min(band.max, Math.max(band.min, sp / made));
          frame(f, feet, p.world, { x: b.pos.x, y: b.pos.y, z: b.pos.z, heading: Math.PI / 2 }, dt, true, null);
          top = Math.max(top, b.pos.y);
          if (feet.weight < 0.99) continue;
          const rep = feet.report() as { legs: LegSay[] };
          for (let s = 0; s < 2; s++) {
            const l = rep.legs[s];
            if (l.planted < 0.99 || !l.grounded) continue;
            planted++;
            // Where it is put: its ground less what of a sudden change of it is still being let in.
            const slack = Math.abs(l.easingM);
            if (slack > EASING) easing++;
            let deepest = 0;
            let touching = false;
            const said: string[] = [];
            for (let w = 0; w < 3; w++) {
              const v = feet.solePoint(s, w, null, tmp);
              if (!v) continue;
              const g = v.y - groundAt(v.x);
              const d = g < 0 ? depthIn(groundAt, v.x, v.y) : 0;
              if (d > deepest) deepest = d;
              if (Math.abs(g) <= 0.01 + slack || (g < 0 && d <= 0.01 + slack)) touching = true;
              said.push(`(${v.x.toFixed(3)}, ${v.y.toFixed(3)}) ${g.toFixed(3)}${d > 0 ? ` ${(d * 1000).toFixed(0)} mm in` : ''}`);
            }
            if (deepest - slack > worst || (!touching && !/touching false/.test(worstAt))) {
              worst = Math.max(worst, deepest - slack);
              worstAt = `frame ${i} body (${b.pos.x.toFixed(3)}, ${b.pos.y.toFixed(3)}) ${s ? 'R' : 'L'} ${said.join(' ')} lift ${l.liftM} easing ${l.easingM} drop ${feet.drop.toFixed(3)} touching ${touching}`;
            }
            // Short of its tread only where the pelvis is lowered its most (`pelvisMost`): the dial's own limit, counted.
            if (deepest > 0.01 + slack || (!touching && feet.drop < tune.pelvisMost - 1e-6)) under++;
            else if (!touching) short++;
          }
        }
        p.world.free();
        total += planted;
        const climbed = top > n * riser - 0.05;
        if (under > 0 || !climbed) allOn = false;
        rows.push(`risers of ${riser} m, ${walkKey ? 'walked' : 'run'} by the game's movement at ${fps} fps: climbed ${climbed ? 'to the top' : `only to ${top.toFixed(2)} m`}, ${planted} planted foot-frames (${easing} letting a change of their ground in), the deepest past what is being let in any sole point stands in a step ${(worst * 1000).toFixed(1)} mm, ${under} off their tread, ${short} short of it with the pelvis lowered its most (${worstAt})`);
      }
    }
  }
  for (const r of rows) note(r);
  ok(allOn && total > 500, `up staircases of risers 0.15, 0.25 and 0.4 m, walked and run by the game's own movement (its autostep lifting the capsule a riser at a time) at 60 and 144 frames a second: every planted sole on its tread within a centimetre, none in a step, but where the pelvis is lowered its most (${total} foot-frames)`);
}
// ---- a copy of the file with one rule broken (the mutations here and at the end) -------------------------------------------------
const SRC = readFileSync(join(REPO, 'src/player/footIk.ts'), 'utf8').replace(/\r\n/g, '\n');
const THREE_URL = import.meta.resolve('three');
async function mutant(from: string, to: string): Promise<typeof FootIk> {
  assert.ok(SRC.includes(from), `a mutation found nothing to change: ${from}`);
  const dir = mkdtempSync(join(tmpdir(), 'footik-'));
  try {
    const out = SRC.replace(from, to)
      .replace(/from 'three'/g, `from '${THREE_URL}'`)
      .replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${pathToFileURL(resolve(REPO, 'src/player', p)).href}'`);
    const file = join(dir, 'footIk.ts');
    writeFileSync(file, out);
    return ((await import(pathToFileURL(file).href)) as { FootIk: typeof FootIk }).FootIk;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- eased, never popped: a planted foot slid across a riser's edge -------------------------------------------------------------
// The rest pose (nothing of the clip moves a foot) slid at half a metre a second off a 0.25 m step: under each heel the
// ground drops a riser in one frame. Each ankle and the pelvis's drop then move by no more a frame than an ease over
// `ik.ease` of a riser gives at that frame's length (and the slide's own share across a slope), at 30, 60 and 144 frames a
// second alike; with the ease at nought (the dial's own snap) they move the riser in one frame.
async function slideOff(Cls: typeof FootIk, ease: number, fps: number): Promise<{ foot: number; drop: number; bound: number; settled: boolean }> {
  const p = await Physics.create();
  flat(p);
  box(p, [-10, 0, -5], [0, 0.25, 5]);
  p.stepOnce();
  const f = figure();
  const tune = tuneNow();
  tune.ease = ease;
  const feet = new Cls(tune, makeRay);
  const dt = 1 / fps;
  const riser = 0.25;
  const bound = riser * (1 - Math.exp(-dt / Math.max(ease, 1e-9))) + 0.5 * dt * 2 + 0.006;
  let foot = 0;
  let drop = 0;
  let last: number[] | null = null;
  let lastDrop = 0;
  // The capsule on the upper step (its edge at x = 0), the body facing +x and sliding on past the edge until both feet are over the floor.
  for (let x = -0.6; x < 0.3; x += 0.5 * dt) {
    frame(f, feet as never, p.world, { x, y: riser, z: 0, heading: Math.PI / 2 }, dt, false, null);
    const a = ['lAnkle', 'rAnkle'].map((n) => f.bones.get(n)!.getWorldPosition(tmp).y);
    if (last && feet.weight > 0.99) {
      for (let s = 0; s < 2; s++) foot = Math.max(foot, Math.abs(a[s] - last[s]));
      drop = Math.max(drop, Math.abs(feet.drop - lastDrop));
    }
    last = a;
    lastDrop = feet.drop;
  }
  // Then held still on the far side: the ease settles, both feet on the floor.
  for (let i = 0; i < fps; i++) frame(f, feet as never, p.world, { x: 0.3, y: riser, z: 0, heading: Math.PI / 2 }, dt, false, null);
  const r = read(feet as never, p.world, null);
  p.world.free();
  return { foot, drop, bound, settled: r.gaps.every((g) => onGround(g)) && Math.abs(r.drop - riser) < 0.01 };
}
{
  const rows: string[] = [];
  let eased = true;
  let snapped = true;
  for (const fps of [30, 60, 144]) {
    const e = await slideOff(FootIk, LOCO_TUNE_SHIPPED.ik.ease, fps);
    const z = await slideOff(FootIk, 0, fps);
    if (!(e.foot <= e.bound && e.drop <= e.bound && e.settled)) eased = false;
    if (!(z.foot > 0.2 && z.drop > 0.2)) snapped = false;
    rows.push(`${fps} fps: an ankle ${(e.foot * 1000).toFixed(1)} mm a frame at most, the pelvis ${(e.drop * 1000).toFixed(1)} mm (the ease's own bound ${(e.bound * 1000).toFixed(1)}), settled on the floor ${e.settled}; at the dial's nought ${(z.foot * 1000).toFixed(0)} and ${(z.drop * 1000).toFixed(0)} mm`);
  }
  for (const r of rows) note(r);
  ok(eased && snapped, `a planted foot slid off a 0.25 m step's edge (the ground under its heel dropping a riser in one frame): each ankle and the pelvis's drop move by no more a frame than an ease of a riser over \`ik.ease\` gives at 30, 60 and 144 frames a second, and settle on the floor; at the dial's nought they move the riser in one frame`);
  const noOff = await mutant('            off[i] = (off[i] - (d - pass)) * decay;', '            off[i] = 0;');
  const m = await slideOff(noOff, LOCO_TUNE_SHIPPED.ik.ease, 144);
  ok(m.foot > m.bound || m.drop > m.bound, `mutation: a sudden change of a planted foot's ground taken whole: at 144 frames a second an ankle moves ${(m.foot * 1000).toFixed(0)} mm in a frame (the ease's own bound ${(m.bound * 1000).toFixed(1)})`);
}

// ---- the knee bends the way the clip bends it, walking up a slope and over a kerb ---------------------------------------------
// The game's movement with the walk clip played at the rate the body's speed asks: every frame a leg is placed, its
// knee's offset from its own hip-to-ankle line leans the way the clip's does (never backward), and the knee leaves the
// clip's own leg plane by no more than its ankle does (the target moved off that plane) and a millimetre.
async function kneeWalk(Cls: typeof FootIk, build: (p: Awaited<ReturnType<typeof import('./grappleBody.ts')['makePhysics']>>) => void, fps: number, ease = LOCO_TUNE_SHIPPED.ik.ease): Promise<{ frames: number; backward: number; plane: number; at: string; dropRate: number }> {
  const H = await import('./grappleBody.ts');
  const p = await H.makePhysics();
  build(p);
  p.stepOnce();
  const b = new H.TestBody(p);
  b.forward.set(1, 0, 0);
  b.right.set(0, 0, 1);
  b.place(0, 0.3, 0);
  b.key('KeyW', true);
  b.key('ShiftLeft', true);
  const f = figure();
  const tune = tuneNow();
  tune.ease = ease;
  const feet = new Cls(tune, makeRay);
  const action = f.mixer.clipAction(clipOf('walking'));
  action.play();
  const band = LOCO_TUNE_SHIPPED.rate;
  const dt = 1 / fps;
  let dropRate = 0;
  let lastDrop = 0;
  let lastY = Number.NaN;
  const names = [['lThigh', 'lShin', 'lAnkle'], ['rThigh', 'rShin', 'rAnkle']];
  const at = (n: string) => f.bones.get(n)!.getWorldPosition(new THREE.Vector3());
  const off = (h: THREE.Vector3, k: THREE.Vector3, a: THREE.Vector3) => {
    const u = a.clone().sub(h).normalize();
    const w = k.clone().sub(h);
    return w.sub(u.multiplyScalar(w.dot(u)));
  };
  let frames = 0;
  let backward = 0;
  let plane = 0;
  let where = '';
  for (let i = 0; i < 5 * fps && b.pos.x < 6.5; i++) {
    b.frame(dt);
    action.timeScale = Math.min(band.max, Math.max(band.min, Math.hypot(b.vel.x, b.vel.z) / 1.672));
    f.rig.legPose?.restore();
    f.mixer.update(dt);
    f.root.position.set(b.pos.x, b.pos.y, b.pos.z);
    f.root.rotation.set(0, Math.PI / 2, 0);
    f.root.updateMatrixWorld(true);
    const pre = names.map((l) => l.map(at));
    const fi = feet.in;
    fi.dt = dt;
    fi.on = b.grounded;
    fi.stairClip = false;
    fi.px = b.pos.x;
    fi.py = b.pos.y;
    fi.pz = b.pos.z;
    fi.heading = Math.PI / 2;
    fi.filter = ALL;
    feet.step(f.rig as never, p.world, null);
    f.root.updateMatrixWorld(true);
    // The pelvis's drop a frame, less what the capsule itself moved (a step's pop the drop answers for the planted foot).
    if (lastY === lastY) dropRate = Math.max(dropRate, (Math.abs(feet.drop - lastDrop) - Math.abs(b.pos.y - lastY)) / dt);
    lastDrop = feet.drop;
    lastY = b.pos.y;
    const post = names.map((l) => l.map(at));
    const rep = feet.report() as { legs: LegSay[] };
    for (let s = 0; s < 2; s++) {
      if (feet.weight < 0.01 || rep.legs[s].planted < 0.01) continue;
      frames++;
      const w0 = off(pre[s][0], pre[s][1], pre[s][2]);
      const w1 = off(post[s][0], post[s][1], post[s][2]);
      if (w0.length() > 0.005 && w1.dot(w0) < 0) backward++;
      const n = pre[s][1].clone().sub(pre[s][0]).cross(pre[s][2].clone().sub(pre[s][0]));
      if (n.length() > 1e-4) {
        n.normalize();
        const kd = Math.abs(post[s][1].clone().sub(post[s][0]).dot(n));
        const ad = Math.abs(post[s][2].clone().sub(post[s][0]).dot(n));
        if (kd - ad > plane) {
          plane = kd - ad;
          where = `frame ${i} leg ${s} knee ${kd.toFixed(3)} ankle ${ad.toFixed(3)} off the clip's plane`;
        }
      }
    }
  }
  p.world.free();
  return { frames, backward, plane, at: where, dropRate };
}
{
  const H = await import('./grappleBody.ts');
  const scenes: [string, (p: Awaited<ReturnType<typeof H.makePhysics>>) => void][] = [];
  for (const deg of [10, 20, 30]) {
    scenes.push([`up a ${deg} degree slope`, (p) => {
      const t = Math.tan(deg * DEG);
      const c = cleanTrimesh(new Float32Array([-20, -20 * t, -20, 20, 20 * t, -20, 20, 20 * t, 20, -20, -20 * t, 20]), new Uint32Array([0, 2, 1, 0, 3, 2]))!;
      const d = RAPIER.ColliderDesc.trimesh(c.vertices, c.indices, TRIMESH_FLAGS);
      d.setCollisionGroups(groups(Group.exterior, Group.all));
      p.world.createCollider(d);
    }]);
  }
  for (const h of [0.2, 0.35]) {
    scenes.push([`up onto a ${h} m kerb and off it`, (p) => {
      H.ground(p, 0);
      H.box(p, [2, 0, -6], [4.5, h, 6]);
    }]);
  }
  let backward = 0;
  let worst = 0;
  let frames = 0;
  let dropRate = 0;
  let snapRate = 0;
  const rows: string[] = [];
  for (const [what, build] of scenes) {
    for (const fps of [30, 60, 144]) {
      const r = await kneeWalk(FootIk, build, fps);
      backward += r.backward;
      frames += r.frames;
      worst = Math.max(worst, r.plane);
      dropRate = Math.max(dropRate, r.dropRate);
      if (fps === 144) snapRate = Math.max(snapRate, (await kneeWalk(FootIk, build, fps, 0)).dropRate);
      rows.push(`${what} at ${fps} fps: ${r.frames} placed leg-frames, ${r.backward} with the knee backward, the knee off the clip's plane past its ankle by ${(r.plane * 1000).toFixed(1)} mm at most${r.at ? ` (${r.at})` : ''}, the pelvis's drop moving ${r.dropRate.toFixed(2)} m/s at most past the capsule's own`);
    }
  }
  for (const r of rows) note(r);
  ok(frames > 2000 && backward === 0 && worst < 0.001, `walking up slopes of 10, 20 and 30 degrees and onto and off kerbs of 0.2 and 0.35 m by the game's movement, the walk clip at its rate, at 30, 60 and 144 frames a second: no knee ever bends backward, and no knee leaves the clip's own leg plane by more than its ankle does (${frames} placed leg-frames)`);
  ok(dropRate < 10 && snapRate > 20, `and the pelvis's drop never moves faster than ${dropRate.toFixed(2)} m/s past the capsule's own move at any of the three (an ease, the same speed whatever a frame's length); at the dial's nought it moves ${snapRate.toFixed(1)} m/s at 144 frames a second (a riser in a frame)`);
  // The two-bone solve's pole read off the line to the target (as the wave first had it): the feet over the same scenes.
  const tb = readFileSync(join(REPO, 'src/anim/twoBone.ts'), 'utf8').replace(/\r\n/g, '\n');
  const from = 'const au = abx * ux + aby * uy + abz * uz;';
  assert.ok(tb.includes(from), `a mutation found nothing to change: ${from}`);
  const dir = mkdtempSync(join(tmpdir(), 'footik-pole-'));
  let oldPole: typeof FootIk;
  try {
    const tbFile = join(dir, 'twoBone.ts');
    writeFileSync(tbFile, tb.replace(from, 'const au = 0;'));
    const out = SRC.replace(/from '\.\.\/anim\/twoBone\.ts'/, `from '${pathToFileURL(tbFile).href}'`)
      .replace(/from 'three'/g, `from '${THREE_URL}'`)
      .replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${pathToFileURL(resolve(REPO, 'src/player', p)).href}'`);
    const file = join(dir, 'footIk.ts');
    writeFileSync(file, out);
    oldPole = ((await import(pathToFileURL(file).href)) as { FootIk: typeof FootIk }).FootIk;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  let back = 0;
  for (const [, build] of scenes) back += (await kneeWalk(oldPole, build, 60)).backward;
  ok(back > 0, `mutation: the knee's pole read off the line to the target: walking the same scenes at 60 frames a second, ${back} placed leg-frames bend the knee backward`);
  // What of a change is the slope's own read off a slope taken everywhere: a heel low in its swing (the walk clip's height
  // band calls it planted) going fast over a kerb's edge passes the kerb in a frame.
  const steep = await mutant('          let st = slopeTan > leg.slope ? slopeTan : leg.slope;', '          let st = SLOPE_FOLLOW;');
  let steepRate = 0;
  for (const [, build] of scenes.slice(3)) steepRate = Math.max(steepRate, (await kneeWalk(steep, build, 144)).dropRate);
  ok(steepRate > 10, `mutation: the slope's share taken on level ground: walking onto and off the kerbs at 144 frames a second the pelvis's drop moves ${steepRate.toFixed(1)} m/s past the capsule's own`);
}

// ---- a foot not planted keeps the clip's own leg, carried down with the pelvis -------------------------------------------------
// Walking down a flight by the game's movement with the descending clip, the drawn body eased over the capsule's snaps as the
// player draws it: every frame a leg is not planted at all, its ankle stands exactly where the clip's ankle stands lowered by
// the pelvis's drop (the clip's own leg, never an ankle left at the clip's height over a dropped hip), and under its hip.
async function swingDown(Cls: typeof FootIk, fps: number): Promise<{ frames: number; worst: number; above: number; dropMost: number }> {
  const H = await import('./grappleBody.ts');
  const { DrawnHeight, DrawnIn } = await import('../../../src/anim/drawnHeight.ts');
  const p = await H.makePhysics();
  H.ground(p, 0);
  const n = 5;
  const tread = 0.3;
  const riser = 0.25;
  H.box(p, [-3, 0, -2], [0, n * riser, 2]);
  for (let i = 0; i < n - 1; i++) H.box(p, [i * tread, 0, -2], [(i + 1) * tread, (n - 1 - i) * riser, 2]);
  p.stepOnce();
  const b = new H.TestBody(p);
  b.forward.set(1, 0, 0);
  b.right.set(0, 0, 1);
  b.place(-1.5, n * riser + 0.02, 0);
  b.key('KeyW', true);
  b.key('ShiftLeft', true);
  const f = figure();
  const feet = new Cls(tuneNow(), makeRay);
  const drawn = new DrawnHeight();
  const di = new DrawnIn();
  const action = f.mixer.clipAction(clipOf(STAIR_CLIPS.down[0]));
  action.play();
  const band = LOCO_TUNE_SHIPPED.rate;
  const dt = 1 / fps;
  let frames = 0;
  let worst = 0;
  let above = 0;
  let dropMost = 0;
  for (let i = 0; i < 6 * fps && b.pos.x < n * tread + 1; i++) {
    const was = { x: b.pos.x, y: b.pos.y, z: b.pos.z, g: b.grounded };
    b.frame(dt);
    di.dt = dt;
    di.dx = b.pos.x - was.x;
    di.dy = b.pos.y - was.y;
    di.dz = b.pos.z - was.z;
    di.askedY = 0;
    di.nx = b.slope.planeNx;
    di.ny = b.slope.planeNy;
    di.nz = b.slope.planeNz;
    di.grounded = was.g;
    drawn.step(di, LOCO_TUNE.stairs);
    action.timeScale = Math.min(band.max, Math.max(band.min, Math.hypot(b.vel.x, b.vel.z) / LOCO_TUNE_SHIPPED.made.stairsDown));
    f.rig.legPose?.restore();
    f.mixer.update(dt);
    f.root.position.set(b.pos.x, b.pos.y + drawn.offset, b.pos.z);
    f.root.rotation.set(0, Math.PI / 2, 0);
    f.root.updateMatrixWorld(true);
    const pre = ['lAnkle', 'rAnkle'].map((nm) => f.bones.get(nm)!.getWorldPosition(new THREE.Vector3()));
    const fi = feet.in;
    fi.dt = dt;
    fi.on = b.grounded;
    fi.stairClip = true;
    fi.px = b.pos.x;
    fi.py = b.pos.y;
    fi.pz = b.pos.z;
    fi.heading = Math.PI / 2;
    fi.filter = ALL;
    feet.step(f.rig as never, p.world, null);
    f.root.updateMatrixWorld(true);
    dropMost = Math.max(dropMost, feet.drop);
    const rep = feet.report() as { legs: LegSay[] };
    for (let s = 0; s < 2; s++) {
      if (rep.legs[s].planted !== 0 || feet.drop < 0.1) continue;
      frames++;
      const post = f.bones.get(s ? 'rAnkle' : 'lAnkle')!.getWorldPosition(new THREE.Vector3());
      const hip = f.bones.get(s ? 'rThigh' : 'lThigh')!.getWorldPosition(new THREE.Vector3());
      worst = Math.max(worst, post.distanceTo(pre[s].clone().setY(pre[s].y - feet.drop)));
      if (post.y > hip.y) above++;
    }
  }
  p.world.free();
  return { frames, worst, above, dropMost };
}
{
  let frames = 0;
  let worst = 0;
  let above = 0;
  let dropMost = 0;
  for (const fps of [30, 60, 144]) {
    const r = await swingDown(FootIk, fps);
    frames += r.frames;
    worst = Math.max(worst, r.worst);
    above += r.above;
    dropMost = Math.max(dropMost, r.dropMost);
  }
  ok(frames > 50 && worst < 1e-6 && above === 0 && dropMost > 0.3, `walking down a flight of 0.25 m risers by the game's movement at 30, 60 and 144 frames a second, the pelvis dropped up to ${dropMost.toFixed(2)} m: every frame a leg is not planted (${frames}), its ankle stands where the clip's stands carried down by the drop (to ${worst.toExponential(1)} m) and never over its hip`);
  const held = await mutant('      q.ty = pC.y + w * (drop + app[0]);', '      q.ty = pC.y + drop + app[0] * w;');
  const m = await swingDown(held, 60);
  ok(m.worst > 0.1, `mutation: a swinging foot held at the clip's height over a dropped pelvis: its ankle stands ${m.worst.toFixed(2)} m from the clip's own leg`);
}

// ---- the cliff's edge ---------------------------------------------------------------------------------------------------------
{
  const tune = tuneNow();
  const p = await Physics.create();
  box(p, [-10, -1, -10], [0, 0, 10]);
  p.stepOnce();
  const f = figure();
  const feet = new FootIk(tune, makeRay);
  // Facing -z (its right hand at +x): the right foot over the edge at x = 0, the body's middle 6 cm inside it.
  const at = { x: -0.06, y: 0, z: 0, heading: Math.PI };
  for (let i = 0; i < 60; i++) frame(f, feet, p.world, at, 1 / 60, false, null);
  const r = read(feet, p.world, null);
  const right = r.legs[1];
  const heel = feet.solePoint(1, 0, null, new THREE.Vector3())!;
  ok(right.grounded && right.pullM > 0 && right.pullM <= tune.edgePull + 1e-9 && heel.x <= 0.005 && onGround(r.gaps[1]), `at a cliff's edge the foot over the air is drawn ${right.pullM.toFixed(2)} m in onto the edge (its heel at x ${heel.x.toFixed(3)}, its sole ${Math.min(...r.gaps[1]).toFixed(3)} m over the ground)`);
  p.world.free();
  const q = await Physics.create();
  box(q, [-10, -1, -10], [0, 0, 10]);
  q.stepOnce();
  const g = figure();
  const t0 = tuneNow();
  t0.edgePull = 0;
  const feet0 = new FootIk(t0, makeRay);
  frame(g, feet0, null, at, 1 / 60, false, null);
  const before = g.bones.get('rAnkle')!.getWorldPosition(new THREE.Vector3()).y;
  for (let i = 0; i < 60; i++) frame(g, feet0, q.world, at, 1 / 60, false, null);
  const r0 = read(feet0, q.world, null);
  const after = g.bones.get('rAnkle')!.getWorldPosition(new THREE.Vector3()).y;
  ok(!r0.legs[1].grounded && r0.legs[1].planted === 0 && Math.abs(after - before) < 1e-9, `and with no pull a foot over the air is left where its clip has it, never dropped (its ankle ${(after - before).toFixed(6)} m from the clip's)`);
  q.world.free();
}

// ---- the body's middle on the very edge (the capsule's round bottom holding it there) -----------------------------------------
{
  const scene = async (Feet: typeof FootIk) => {
    const p = await Physics.create();
    box(p, [-10, -1, -10], [0, 0, 10]);
    p.stepOnce();
    const f = figure();
    const feet = new Feet(tuneNow(), makeRay);
    // Facing -z, its right hand at +x: the middle 2 cm out over the drop, every ray in toward it over the air.
    const at = { x: 0.02, y: 0, z: 0, heading: Math.PI };
    for (let i = 0; i < 60; i++) frame(f, feet as never, p.world, at, 1 / 60, false, null);
    const r = read(feet as never, p.world, null);
    p.world.free();
    return r;
  };
  const r = await scene(FootIk);
  const right = r.legs[1];
  ok(right.grounded && right.pullM > 0.02 && onGround(r.gaps[1]), `a capsule resting with its middle 2 cm out over a drop: the foot over the air is drawn ${right.pullM.toFixed(2)} m, on past the middle onto the capsule's own ground (its sole ${Math.min(...r.gaps[1]).toFixed(3)} m over it)`);
}
// ---- aboard a ship's rooms --------------------------------------------------------------------------------------------------
{
  const tune = tuneNow();
  const room = await Physics.create();
  box(room, [-6, -1, -6], [6, 0, 6]);
  box(room, [0, 0, -3], [3, 0.25, 3]);
  room.stepOnce();
  const hull = new THREE.Group();
  hull.position.set(140, 60, -80);
  hull.quaternion.setFromEuler(new THREE.Euler(0.12, 0.8, -0.2));
  hull.updateMatrixWorld(true);
  const f = figure(hull);
  const toPhys = hull.matrixWorld.clone().invert();
  const feet = new FootIk(tune, makeRay);
  const at = { x: 0, y: 0.25, z: 0, heading: 0 };
  for (let i = 0; i < 90; i++) frame(f, feet, room.world, at, 1 / 60, false, toPhys);
  const r = read(feet, room.world, toPhys);
  ok(r.gaps.every((g) => onGround(g)) && Math.abs(r.drop - 0.25) < 0.01, `aboard a ship's rooms, the hull turned and pitched in the world: both soles on the rooms' floor and step in the rooms' frame (gaps ${r.gaps.flat().map((v) => v.toFixed(3)).join(', ')} m), the pelvis lowered ${r.drop.toFixed(3)} m`);
  room.world.free();
}

// ---- eased alike at every frame rate ------------------------------------------------------------------------------------------
/** The weight and the pelvis's drop every sixth of a second, placed for a second and a half beside a step and let go for as long. */
async function easeTrace(Cls: typeof FootIk, fps: number): Promise<number[]> {
  const p = await Physics.create();
  flat(p);
  box(p, [0, 0, -5], [5, 0.25, 5]);
  p.stepOnce();
  const f = figure();
  const feet = new Cls(tuneNow(), makeRay);
  const at = { x: 0.05, y: 0.25, z: 0, heading: 0 };
  const out: number[] = [];
  const n = Math.round(3 * fps);
  for (let i = 1; i <= n; i++) {
    frame(f, feet as never, p.world, at, 1 / fps, false, null, i <= n / 2);
    if (i % (fps / 6) === 0) out.push(feet.weight, feet.drop);
  }
  p.world.free();
  return out;
}
async function easeApart(Cls: typeof FootIk): Promise<{ w: number; d: number; n: number }> {
  const a = await easeTrace(Cls, 30);
  let w = 0;
  let d = 0;
  for (const fps of [60, 144]) {
    const b = await easeTrace(Cls, fps);
    for (let i = 0; i < a.length; i += 2) {
      w = Math.max(w, Math.abs(a[i] - b[i]));
      d = Math.max(d, Math.abs(a[i + 1] - b[i + 1]));
    }
  }
  return { w, d, n: a.length };
}
{
  const { w, d, n } = await easeApart(FootIk);
  ok(n === 36 && w < 1e-9 && d < 1e-4, `the placement eases in and out and the pelvis down and back up alike at 30, 60 and 144 frames a second, sampled every sixth of a second (the weight to ${w.toExponential(1)}, the pelvis to ${(d * 1000).toFixed(3)} mm)`);
}
// ---- restore, and 'before' -------------------------------------------------------------------------------------------------
{
  const p = await Physics.create();
  flat(p);
  box(p, [0, 0, -5], [5, 0.25, 5]);
  p.stepOnce();
  const at = { x: 0, y: 0.25, z: 0, heading: 0 };
  const walk = clips.find((c) => c.name === `mx_${STAIR_CLIPS.up[0]}`)!;
  const legNames = ['lThigh', 'lShin', 'lAnkle', 'lToe', 'rThigh', 'rShin', 'rAnkle', 'rToe'].filter((n) => target.joints.some((j) => j.name === n));
  const quats = (f: Figure) => legNames.flatMap((n) => f.bones.get(n)!.quaternion.toArray());
  // The clip's own pose, with no feet at all.
  const bare = figure();
  bare.mixer.clipAction(walk).play();
  const placed = figure();
  placed.mixer.clipAction(walk).play();
  const feet = new FootIk(tuneNow(), makeRay);
  let restored = true;
  for (let i = 0; i < 30; i++) {
    bare.mixer.update(1 / 60);
    frame(placed, feet, p.world, at, 1 / 60, false, null);
    placed.rig.legPose?.restore();
    const a = quats(bare);
    const b = quats(placed);
    if (!a.every((v, k) => Object.is(v, b[k]))) restored = false;
    // Placed again for the next frame (restore is asked again at its top, writing nothing a second time).
  }
  ok(restored, 'the rig\'s hook (`restore`) puts the clip\'s own pose back on every leg bone to the bit before the mixer runs again');
  const t = tuneNow();
  t.rule = 'before';
  const off = new FootIk(t, makeRay);
  const offFig = figure();
  offFig.mixer.clipAction(walk).play();
  const bare2 = figure();
  bare2.mixer.clipAction(walk).play();
  let same = true;
  for (let i = 0; i < 30; i++) {
    bare2.mixer.update(1 / 60);
    frame(offFig, off, p.world, at, 1 / 60, false, null);
    const a = quats(bare2);
    const b = quats(offFig);
    if (!a.every((v, k) => Object.is(v, b[k])) || !Object.is(offFig.root.position.y, 0.25)) same = false;
  }
  ok(same && off.casts === 0 && off.weight === 0 && off.drop === 0, 'under \'before\' no leg bone and no root is written and no ray cast: the clip\'s pose to the bit');
  p.world.free();
}

// ---- the game's hand-overs ----------------------------------------------------------------------------------------------------
{
  const text = (f: string) => readFileSync(join(REPO, f), 'utf8');
  const rig = text('src/player/rig.ts');
  const player = text('src/player/player.ts');
  const peers = text('src/net/remotePlayers.ts');
  ok(/this\.legPose\?\.restore\(\);\n    this\.mixer\.update\(dt\);/.test(rig.replace(/\r/g, '')), 'the rig asks its legs\' hook to put the clip\'s pose back at the top of its update, before its mixer');
  ok(player.includes('    this.placeVisual();\r\n    this.placeFeet(dt);') || player.includes('    this.placeVisual();\n    this.placeFeet(dt);'), 'the player places its feet after the figure is placed, last of its update');
  ok(player.includes('this.feet.step(rig, this.physics.world, room ? this.roomInverse.copy(roomFrame(room)).invert() : null);'), 'and aboard a ship\'s rooms in the rooms\' own frame');
  ok((player.match(/this\.feetOff\(\);/g) ?? []).length === 5, 'and every branch off the feet (the ragdoll, the editor\'s flight, riding, noclip, adrift) lets them go');
  ok(peers.includes('if (rig) r.feet.undrop(rig);') && peers.includes('r.feet.step(rig, fw, null);'), 'another player\'s figure takes last frame\'s drop off before anything writes its root, and its feet are placed after every placement pass');
}

// ---- mutations: each rule broken in a copy of the file, each failing what it decides --------------------------------------------
{
  /** A body beside a step, on a face, or at a cliff's edge, `frames` frames: what the feet made of it. */
  const stand = async (Cls: typeof FootIk, build: (p: Phys) => void, at: Place, frames = 90, tune = tuneNow()): Promise<Read> => {
    const p = await Physics.create();
    build(p);
    p.stepOnce();
    const f = figure();
    const feet = new Cls(tune, makeRay);
    for (let i = 0; i < frames; i++) frame(f, feet as never, p.world, at, 1 / 60, false, null);
    const r = read(feet as never, p.world, null);
    p.world.free();
    return r;
  };
  const beside = (Cls: typeof FootIk) => stand(Cls, (p) => { flat(p); box(p, [0, 0, -5], [5, 0.4, 5]); }, { x: 0.05, y: 0.4, z: 0, heading: 0 });
  const face = (Cls: typeof FootIk, deg: number) => stand(Cls, (p) => { slope(p, 'trimesh', deg); }, { x: 0.3, y: 0.3 * Math.tan(deg * DEG), z: 0.2, heading: Math.PI / 2 });
  const cliff = (Cls: typeof FootIk) => stand(Cls, (p) => box(p, [-10, -1, -10], [0, 0, 10]), { x: -0.06, y: 0, z: 0, heading: Math.PI }, 60);
  {
    const capped = await mutant('if (this.probe(world, leg, slot) && (d <= il || Math.abs(leg.probes[slot].y - f.py) <= EDGE_LEVEL)) {', 'if (this.probe(world, leg, slot) && d <= il) {');
    const r = await stand(capped, (p) => box(p, [-10, -1, -10], [0, 0, 10]), { x: 0.02, y: 0, z: 0, heading: Math.PI }, 60);
    ok(!r.legs[1].grounded, 'mutation: the edge pull held to the body\'s middle: a capsule resting with its middle out over the drop leaves that foot in the air');
  }  const fails = (r: Read) => !r.gaps.every((g) => onGround(g));
  ok(fails(await beside(await mutant('    const drop = this.drop;', '    const drop = 0;'))), 'mutation: the pelvis never lowered: beside a 0.4 m step the lower foot stays in the air');
  ok(fails(await face(await mutant('        turnBetweenIn(qTilt, TA);\n      } else qTilt.set(0, 0, 0, 1);', '        qTilt.set(0, 0, 0, 1);\n      } else qTilt.set(0, 0, 0, 1);'), 20)), 'mutation: the foot not turned to its slope: on a 20 degree face its heel or its ball goes into it');
  {
    const real = await face(FootIk, 70);
    const broken = await face(await mutant('        if (lt > lift) lift = lt;', '        if (false) lift = lt;'), 70);
    const inside = (r: Read) => Math.min(...r.gaps[0], ...r.gaps[1]) < -0.01;
    ok(!inside(real) && inside(broken), `mutation: the toe's tip not set on its ground: on a 70 degree face (steeper than any the body stands on), past what the foot turns and the toe bends, the tip goes into it (${Math.min(...broken.gaps[0]).toFixed(3)} m; the rule keeps it out, ${Math.min(...real.gaps[0]).toFixed(3)})`);
  }
  ok(!(await cliff(await mutant('const most = Math.min(PULL_MOST, Math.floor(tune.edgePull / PULL_STEP + 1e-9));', 'const most = 0;'))).legs[1].grounded, 'mutation: no edge pull: at a cliff\'s edge the foot over the air finds nothing');
  const noBall = await mutant('          const lb = leg.probes[2].y - vB.y;\n          if (lb > lift) lift = lb;', '          const lb = leg.probes[2].y - vB.y;');
  ok((await stairWalk(noBall, tuneNow(), 0.25, WALK, 0.5, 60)).under > 0, 'mutation: off a step\'s edge the ball not set on its own ground: walking up a staircase a ball goes into a riser');
  const bendDown = await mutant('const aim = !onPlane && tipGround < gH ? gH : tipGround;', 'const aim = tipGround;');
  {
    // Measured as the true depth into the step (the nearest way out, a corner's diagonal included), the toe swung back into
    // the nose goes about a centimetre in; the rule keeps it out.
    const bd = await stairWalk(bendDown, tuneNow(), 0.15, RUN, 1, 60);
    const re = await stairWalk(FootIk, tuneNow(), 0.15, RUN, 1, 60);
    ok(bd.deepRaw >= 0.005 && bd.deepRaw > 5 * re.deepRaw, `mutation: the toe bent down over a step's edge: running down a staircase a toe swings back into the step's nose (${(bd.deepRaw * 1000).toFixed(1)} mm in; the rule keeps it to ${(re.deepRaw * 1000).toFixed(1)})`);
  }
  // The heel's ground read under the heel rather than the ankle decides nothing these walks can see (the clip turns a
  // foot at most a few centimetres off the plumb of its ankle, and the ball's and the tip's own grounds already keep the
  // foot out of a step), so it has no mutation here: it is the geometry, kept.
  {
    const capsuleMost = await mutant('    const most = tune.pelvisMost + (over > 0 ? over : 0);', '    const most = tune.pelvisMost;');
    const p = await Physics.create();
    flat(p);
    box(p, [0, 0, -5], [5, 0.4, 5]);
    p.stepOnce();
    const f = figure();
    const feet = new capsuleMost(tuneNow(), makeRay);
    for (let i = 0; i < 90; i++) frame(f, feet as never, p.world, { x: 0.05, y: 0.9, z: 0, heading: 0, py: 0.4 }, 1 / 60, false, null);
    const r = read(feet as never, p.world, null);
    ok(!r.gaps.every((g) => onGround(g)), 'mutation: the pelvis\'s most measured from the drawn root: a drawn body held over the capsule leaves the lower foot in the air');
    p.world.free();
  }
  const chase = await easeApart(await mutant('      this.drop -= this.drop * k;\n      if (this.drop < need) this.drop = need;', '      this.drop += (need - this.drop) * k;'));
  ok(chase.d > 1e-3, `mutation: the pelvis chasing a need that eases out: back up ${(chase.d * 1000).toFixed(1)} mm apart between 30 and 144 frames a second`);
  {
    // The clip's own move of the foot not followed as it stands (taken for the ground jumping): a stair clip's planted
    // foot, which its clip moves up and down its tread a step at a time, lags its own clip.
    const noClip = await mutant('          acc[0] = dp + dxz * st;', '          acc[0] = dxz * st;');
    let lagged = 0;
    let total = 0;
    for (const [r, ids, sp] of [[0.25, WALK, 0.5], [0.25, RUN, 1]] as [number, string[], number][]) {
      const w = await stairWalk(noClip, tuneNow(), r, ids, sp, 60);
      lagged += w.easing;
      total += w.planted;
    }
    ok(lagged > total * 0.1, `mutation: the clip's own move of a planted foot held back as though the ground had jumped: on the staircase ${lagged} of ${total} planted foot-frames lag their clip by more than a centimetre`);
  }
  {
    const s = await swayStand(await mutant('const KEPT = 4;', 'const KEPT = 1;'));
    ok(s.after > 0, `mutation: one answer kept a slot: an idle swaying the feet is cast for again and again (${s.after} rays after its first sway)`);
  }
  const planted = await mutant('      if (stairClip) {\n        const v =', '      if (false) {\n        const v =');
  ok((await stairWalk(planted, tuneNow(), 0.25, WALK, 0.5, 60)).planted < (await stairWalk(FootIk, tuneNow(), 0.25, WALK, 0.5, 60)).planted / 2, 'mutation: a stair clip\'s planted foot read by its height (which climbs a tread a step in the clip): most planted frames are lost');
}
// ---- the steady hips in the air and through a landing (`ik.hipsLand`, the owner's 2026-11-16) ------------------------------
// The legs made to ask a drop for a second (the drawn root a quarter metre over the capsule's feet), then the body in the air
// or through a landing clip and standing again: under 'off' nothing of that drop is kept; under 'before' (14eab9f's) it is
// held over `hipHold`, which was the dip on landing.
{
  type HipsLand = 'off' | 'before';
  const run = async (rule: HipsLand, air: boolean): Promise<{ asked: number; during: number; after: number; away: boolean }> => {
    const p = await Physics.create();
    flat(p);
    p.stepOnce();
    const f = figure();
    const feet = new FootIk({ ...tuneNow(), hips: 'steady', hipsLand: rule }, makeRay);
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) frame(f, feet, p.world, { x: 0, y: 0.25, z: 0, heading: 0, py: 0 }, dt, false, null);
    const asked = feet.drop;
    let away = false;
    feet.in.landing = !air;
    for (let i = 0; i < 30; i++) {
      frame(f, feet, p.world, { x: 0, y: 0, z: 0, heading: 0 }, dt, false, null, !air);
      away ||= feet.away;
    }
    const during = feet.drop;
    feet.in.landing = false;
    for (let i = 0; i < 30; i++) frame(f, feet, p.world, { x: 0, y: 0, z: 0, heading: 0 }, dt, false, null);
    const after = feet.drop;
    p.world.free();
    return { asked, during, after, away };
  };
  // What the steady hips drop standing on flat ground with nothing asked before (the figure's own rest pose's ask).
  const p = await Physics.create();
  flat(p);
  p.stepOnce();
  const f = figure();
  const still = new FootIk({ ...tuneNow(), hips: 'steady', hipsLand: 'off' }, makeRay);
  for (let i = 0; i < 120; i++) frame(f, still, p.world, { x: 0, y: 0, z: 0, heading: 0 }, 1 / 60, false, null);
  const rest = still.drop;
  p.world.free();
  for (const air of [false, true]) {
    const what = air ? 'half a second in the air' : 'a landing clip of half a second';
    const off = await run('off', air);
    const before = await run('before', air);
    ok(off.asked > rest + 0.05 && before.asked > rest + 0.05, `the legs ask the hips down first (${off.asked.toFixed(3)} and ${before.asked.toFixed(3)} m; standing with nothing asked ${rest.toFixed(4)} m)`);
    ok(off.away && off.during < 0.005 && Math.abs(off.after - rest) < 0.005, `'off': through ${what} the hips let go of the drop they held (${off.during.toFixed(4)} m by its end) and come back to standing's own (${off.after.toFixed(4)} m half a second on, standing ${rest.toFixed(4)})`);
    ok(!before.away && before.during > rest + 0.05 && before.after > rest + 0.02, `'before' (14eab9f's): through ${what} the drop asked before is held (${before.during.toFixed(3)} m by its end, ${before.after.toFixed(3)} m half a second on)`);
  }
}
console.log(`footIk: ${checks} checks passed`);
