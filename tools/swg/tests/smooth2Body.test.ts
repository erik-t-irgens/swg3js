// Climbing II, Smoothness II, items 3 and 4, through the game's own climbing and movement on the real Rapier (the grapple's
// harness, tools/swg/tests/grappleBody.ts) with a posed figure on the body (tools/swg/tests/climbFigure.ts: the game's own rig,
// the pack's clips fitted to the converted human male, the game's own hang hand-over and limbs, and the figure's spheres
// measured off the human male's own rest mesh by the game's own measure), at 30, 60, 144 and 240 frames a second:
//  - the measure (src/player/bodySpheres.ts): sixteen spheres from the mesh, deterministic, three's own skinned mesh read as
//    the GLB is; the chest and pelvis by their thinnest way;
//  - item 3 (`climb.bodyClear` 'spheres'): shimmied round the course's corners, bends and curves, braced and free, the
//    figure's trunk and legs are pushed out of the walls (`clearClimb`), each placed hand kept on its place on the lip (the
//    push given up where a hand would no longer reach), and the frames with a sphere over 1 cm deep counted against 'before';
//  - item 4 (`move.duckHead` 'clear'): walked and run under beams lowered 5 cm at a time from the standing head's top, the
//    drawn head sphere never in a beam (over the capsule by the walk's own measure, and at the duck's deepest the crouched
//    walk's own over the feet, under which the body lies down); under 'before' it walks into the beams the capsule passes under.
// The player's own glue round the game's functions (where it calls them) is pinned as text at the end.
//
// Run: node tools/swg/tests/smooth2Body.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CLIMB_TUNE, resetClimbTune as resetShipped, climbSmooth3Before, tuneClimb } from '../../../src/anim/climbTune.ts';
// (Smoothness III's switches at their other setting too: this suite holds Smoothness II's climbing.)
const resetClimbTune = (): void => {
  resetShipped();
  climbSmooth3Before();
};
import { MOVE_TUNE, resetMoveTune as resetMoveShipped, moveSmooth3Before, tuneMove } from '../../../src/anim/moveTune.ts';
// (Smoothness III's body switches at their other setting too: this suite holds the body before it.)
const resetMoveTune = (): void => {
  resetMoveShipped();
  moveSmooth3Before();
};
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { LEDGE_HANG } from '../../../src/player/ledge.ts';
import { BodySpheres, HEAD_OVER_MOST, headOverHeld, measureSpheres, sphereSourceOf, SPHERE_COUNT, SPH_HEAD, SPHERES_TRUNK } from '../../../src/player/bodySpheres.ts';
import { PLACED } from '../../../src/player/climbClear.ts';
import { DEEP_SHARE, STAND_TALL } from '../../../src/player/bodyShape.ts';
import { bodyAt, runUntil, shimmy, standPiece, tap } from './climbCourseBody.ts';
import { drawClimb, figure, figureScale, FIGURE_SPHERES, HAVE_BODY, sphereWorst, type Figure } from './climbFigure.ts';
import { glbSphereSource, speciesBodyFiles } from './sphereFixtures.ts';
import { REPO } from './oldModules.ts';
import { box, ground, makePhysics, TestBody } from './grappleBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;
const cm = (m: number) => (m * 100).toFixed(1);

if (!HAVE_BODY) {
  note('no converted human male here: the figure\'s measures need his mesh; the rule checks below run on a mesh of their own');
}

// ---- 1. the measure ------------------------------------------------------------------------------------------------------
{
  // A mesh of our own: two joints a metre apart, a ring of vertices about the segment 0.1 m out, and a blob about the second.
  const names = ['root', 'lThigh', 'lShin', 'lAnkle', 'Head'];
  const parents = [-1, 0, 1, 2, 0];
  const at = [[0, 0, 0], [0.1, 0, 0], [0.1, -0.5, 0], [0.1, -1, 0], [0, 0.7, 0]];
  const bind: number[] = [];
  for (const p of at) bind.push(...new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]).elements);
  const positions: number[] = [];
  const joint: number[] = [];
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    positions.push(0.1 + 0.1 * Math.cos(a), -0.25, 0.1 * Math.sin(a));
    joint.push(1);
  }
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    positions.push(0.12 * Math.cos(a), 0.8 + 0.12 * Math.sin(a), 0);
    joint.push(4);
  }
  const parts = measureSpheres({ positions, joint, names, parents, bind });
  const thigh = parts.find((p) => p.id === 'lThigh')!;
  const head = parts.find((p) => p.id === 'head')!;
  ok(parts.length === SPHERE_COUNT, `the measure answers every part (${parts.length})`);
  ok(Math.abs(thigh.radius - 0.1) < 1e-9 && Math.abs(thigh.at[1] + 0.25) < 1e-9, `a limb's sphere: its segment's middle and its vertices' distance from it (r ${thigh.radius.toFixed(3)}, at ${thigh.at.map((v) => v.toFixed(2))})`);
  ok(Math.abs(head.radius - 0.12) < 1e-9 && Math.abs(head.at[1] - 0.1) < 1e-9, `a blob's sphere: its vertices' mean and their distance from it, in its joint's frame (r ${head.radius.toFixed(3)}, at ${head.at.map((v) => v.toFixed(2))})`);
  ok(parts.filter((p) => p.vertices === 0).length === SPHERE_COUNT - 2, 'a part with no vertices of its own has no sphere');
  // Three's own skinned mesh read as the measure's source gives the same spheres.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('skinIndex', new THREE.Float32BufferAttribute(joint.flatMap((j) => [j, 0, 0, 0]), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(joint.flatMap(() => [1, 0, 0, 0]), 4));
  const bones = names.map((n) => Object.assign(new THREE.Bone(), { name: n }));
  bones.forEach((b, i) => {
    b.position.fromArray(at[i]);
    if (parents[i] >= 0) {
      b.position.sub(new THREE.Vector3().fromArray(at[parents[i]]));
      bones[parents[i]].add(b);
    }
  });
  bones[0].updateMatrixWorld(true);
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  const viaThree = measureSpheres(sphereSourceOf([mesh])!);
  const same = viaThree.every((p, i) => Math.abs(p.radius - parts[i].radius) < 1e-6 && p.at.every((v, k) => Math.abs(v - parts[i].at[k]) < 1e-6));
  ok(same, "three's own skinned mesh measured gives the very spheres the GLB's reading does");
}
if (HAVE_BODY) {
  const again = measureSpheres(glbSphereSource(speciesBodyFiles(REPO, 'human_male')));
  ok(JSON.stringify(again) === JSON.stringify(FIGURE_SPHERES), 'the human male measured again is the same to the bit');
  const r = (id: string) => FIGURE_SPHERES.find((p) => p.id === id)!.radius;
  ok(FIGURE_SPHERES.every((p) => p.vertices > 0) && r('head') > 0.06 && r('head') < 0.12 && r('chest') > 0.08 && r('chest') < 0.15 && r('lShin') > 0.03 && r('lShin') < 0.08, `the human male's sixteen spheres off his own mesh (head ${r('head').toFixed(3)}, chest ${r('chest').toFixed(3)} by its thinnest way, pelvis ${r('pelvis').toFixed(3)}, shin ${r('lShin').toFixed(3)}, foot ${r('lFoot').toFixed(3)} m)`);
}

// ---- 2. item 3: round the corners -----------------------------------------------------------------------------------------
interface Tally {
  frames: number;
  deep: number;
  worst: number;
  worstPart: string;
  handOff: number;
  pushMost: number;
}
const GV = new THREE.Vector3();
async function corner(id: string, fps: number, on: boolean): Promise<Tally> {
  resetClimbTune();
  resetMoveTune();
  tuneClimb({ bodyClear: on ? 'spheres' : 'before' });
  const s = await standPiece(climbCourse({ extras: true, pieces: [id] }).pieces[0]);
  const { b, w } = bodyAt(s, 'stand', fps);
  const F = figure();
  b.ledgeScale = figureScale(F);
  const T: Tally = { frames: 0, deep: 0, worst: 0, worstPart: '', handOff: 0, pushMost: 0 };
  const hold = b.frame.bind(b);
  b.frame = (dt: number) => {
    hold(dt);
    if (!drawClimb(b, F, dt)) return;
    sphereWorst(b, F);
    // The trunk's and the legs' (the hands' and arms' are their own solves'): the measure item 3 answers for.
    let d = 0;
    let part = '';
    for (let i = 0; i < SPHERE_COUNT; i++) {
      if (!((SPHERES_TRUNK >>> i) & 1) || !(F.spheres.after[i] > d)) continue;
      d = F.spheres.after[i];
      part = F.spheres.parts[i].id;
    }
    T.frames++;
    if (d > 0.01) T.deep++;
    if (d > T.worst) {
      T.worst = d;
      T.worstPart = part;
    }
    // Each hand the climb placed on its lip, after the solves: how far from its place.
    for (let side = 0; side < 2; side++) {
      if (!(PLACED[side] >= 0.99 && F.lp.handW[side] >= 0.99)) continue;
      const g = F.lp.gripNow(F.rig as never, side, null, GV);
      if (g) T.handOff = Math.max(T.handOff, Math.hypot(g.x - F.lp.hand[side * 3], g.y - F.lp.hand[side * 3 + 1], g.z - F.lp.hand[side * 3 + 2]));
    }
    T.pushMost = Math.max(T.pushMost, F.spheres.push.length());
  };
  b.key('KeyE', true);
  tap(b, 'Space', fps);
  runUntil(b, fps, 2.5, () => b.ledge.phase === LEDGE_HANG);
  b.key('KeyE', false);
  runUntil(b, fps, 0.5, () => false);
  shimmy(s, b, w, 'KeyD', fps);
  runUntil(b, fps, 0.4, () => false);
  shimmy(s, b, w, 'KeyA', fps);
  b.frame = hold;
  b.physics.world.removeRigidBody(b.body);
  return T;
}
if (HAVE_BODY) {
  const CORNERS = ['corner-outer-90', 'corner-inner-90', 'bend-outer-60', 'bend-inner-60', 'bend-inner-30', 'curve-outer-3m', 'curve-inner-3m', 'free-corner-outer-90', 'free-corner-inner-90', 'free-bend-inner-45'];
  for (const fps of RATES) {
    let deepOn = 0;
    let deepOff = 0;
    for (const id of CORNERS) {
      const on = await corner(id, fps, true);
      const off = await corner(id, fps, false);
      deepOn += on.deep;
      deepOff += off.deep;
      ok(on.frames > fps && off.pushMost === 0, `${id} @${fps}: driven round with the figure (${on.frames} frames); under 'before' nothing pushed`);
      ok(on.handOff <= 0.012, `${id} @${fps}: every placed hand within 1.2 cm of its place on the lip while pushed (worst ${cm(on.handOff)} cm; 'before' ${cm(off.handOff)})`);
      ok(on.deep <= off.deep, `${id} @${fps}: no more frames with the trunk or a leg over 1 cm in a wall than before (${on.deep} of ${on.frames}, 'before' ${off.deep}; worst ${cm(on.worst)} cm ${on.worstPart}, 'before' ${cm(off.worst)} ${off.worstPart}; push at most ${cm(on.pushMost)} cm)`);
    }
    ok(deepOn * 2 < deepOff, `@${fps}: over every corner, bend and curve, the frames with the trunk or a leg over 1 cm in a wall at most halved (${deepOn}, 'before' ${deepOff})`);
    note(`@${fps}: the brief's "no sphere deeper than 1 cm" is not met on the 60 and 90 degree corners: the feet's own solve plants them on the held face, which takes a shin or a thigh across a corner's other face, and the push is given up where a placed hand would leave its lip`);
  }
}

// ---- 3. item 4: under beams ------------------------------------------------------------------------------------------------
// The drawn top over the capsule's, as the player measures it (the game's own `headOverHeld` over the posed figure): the human
// male walking and running in the open, his own clips.
function openOver(run: boolean): { over: number; ahead: number; r: number } {
  const F = figure();
  const rig = F.rig;
  rig.prefer('walk' as never, 'mx_walking');
  rig.prefer('run' as never, 'mx_running');
  let held = 0;
  let ahead = -1;
  for (let i = 0; i < 120; i++) {
    rig.setState((run ? 'run' : 'walk') as never, 1, null);
    rig.update(1 / 60);
    F.group.updateMatrixWorld(true);
    rig.twistTorso(0, 0);
    F.root.updateMatrixWorld(true);
    F.spheres.sample();
    F.spheres.headFeet = 0;
    F.spheres.headTall = STAND_TALL;
    F.spheres.headDt = 1 / 60;
    F.spheres.holdHead();
    held = F.spheres.headHeld;
    ahead = Math.max(ahead, F.spheres.cz[SPH_HEAD] - F.group.position.z);
  }
  return { over: held, ahead, r: F.spheres.r[SPH_HEAD] };
}
// The drawn top over the feet at the duck's deepest, as the player measures it (the game's own `holdDeep`): the human male's own
// crouched walk, the clip the duck wears there. In the browser the duck's deepest carried the head 0.25 to 0.4 m over the shrunk
// capsule, so no duck clears a roof under this, and the body lies down for it instead.
function openDeep(): number {
  const F = figure();
  const rig = F.rig;
  rig.prefer('crouchWalk' as never, 'mx_crouched_walking');
  F.spheres.deepHeld = -1;
  for (let i = 0; i < 180; i++) {
    rig.setState('crouchWalk' as never, 1, null);
    rig.update(1 / 60);
    F.group.updateMatrixWorld(true);
    rig.twistTorso(0, 0);
    F.root.updateMatrixWorld(true);
    F.spheres.sample();
    F.spheres.headFeet = 0;
    F.spheres.headDt = 1 / 60;
    F.spheres.holdDeep();
  }
  return F.spheres.deepHeld;
}
// One beam across the way, its underside at `under` over the floor, 0.3 m deep, walked or run under from 4 m before it, the
// duck handed the drawn top as the player hands it. What the duck answers for: the capsule's top and the drawn top over it
// (`headOver`) under the beam by `headSkin`, every frame the body is under it.
async function beam(under: number, fps: number, clear: boolean, run: boolean, over: number, ahead: number, hr: number, deep: number): Promise<{ worst: number; ducked: number; passed: boolean; lay: boolean }> {
  resetClimbTune();
  resetMoveTune();
  tuneMove({ duckHead: clear ? 'clear' : 'before' });
  const physics = await makePhysics();
  ground(physics, 0);
  box(physics, [-3, under, 4], [3, under + 0.3, 4.3], false);
  physics.step(1 / 60);
  const b = new TestBody(physics);
  b.jka.forceLevel = 0;
  b.place(0, 0, 0);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.heading = 0;
  let worst = -1;
  let ducked = 0;
  let lay = false;
  const hold = b.frame.bind(b);
  b.frame = (dt: number) => {
    b.shapeIn.headOver = over;
    b.shapeIn.deepHead = deep;
    hold(dt);
    if (b.prone) lay = true;
    if (b.shape.tall < STAND_TALL - 0.01) ducked++;
    // The drawn head under the beam (its sphere's own place along the way, as the figure carries it ahead of the body): how far
    // the drawn top reaches past the beam's underside less the skin.
    // At the duck's deepest the drawn head is the crouched walk's own over the feet, whatever the capsule (the browser's finding).
    const top = b.shape.share >= DEEP_SHARE || b.shape.bend > 0 ? b.pos.y + deep : b.pos.y + b.shape.tall + over;
    if (!b.prone && b.pos.z + ahead + hr > 4 && b.pos.z + ahead - hr < 4.3) worst = Math.max(worst, top + MOVE_TUNE.headSkin - under);
  };
  b.key('KeyW', true);
  if (run) b.key('ShiftLeft', true);
  // (Six seconds: a run laid down 1.3 m before a beam crawls under it at the crawl's 0.66 m/s.)
  b.run(fps, 6);
  b.key('KeyW', false);
  b.key('ShiftLeft', false);
  b.frame = hold;
  return { worst, ducked, passed: b.pos.z > 4.6, lay };
}
if (HAVE_BODY) {
  const walkO = openOver(false);
  const runO = openOver(true);
  const deep = openDeep();
  ok(deep > 1.0 && deep < 1.6, `the human male's crouched walk carries his drawn top ${cm(deep)} cm over his feet (the duck's deepest, which no roof under it lets him walk under)`);
  // After the round's review: the crouch's head read off its clip once (the player's `measureDeep`, `posedHighest` over the
  // rig's crouch clips), so the duck knows it before the first deep duck, and never from a pose still crossfading into the
  // crouch (the live read once held 1.51 m from such frames and laid the body down under a 1.5 m beam it walked under before).
  {
    const F = figure();
    const rig = F.rig;
    const S = F.spheres;
    F.group.updateMatrixWorld(true);
    const bones: THREE.Object3D[] = [];
    F.root.traverse((o) => bones.push(o));
    const was = bones.map((o) => [...o.position.toArray(), ...o.quaternion.toArray()].join());
    const clipDeep = rig.posedHighest(['mx_crouched_walking', 'mx_no_such_clip'], 48, () => {
      S.sample();
      S.topOfUpper();
      return S.topNow - rig.root.matrixWorld.elements[13];
    });
    ok(bones.every((o, i) => [...o.position.toArray(), ...o.quaternion.toArray()].join() === was[i]), 'reading the crouch\'s head off its clip leaves every node of the figure as it stood');
    // The live pose's own highest top over two seconds of the crouched walk once its crossfade is done (frame by frame, no hold).
    rig.prefer('crouchWalk' as never, 'mx_crouched_walking');
    let live = -1;
    for (let i = 0; i < 180; i++) {
      rig.setState('crouchWalk' as never, 1, null);
      rig.update(1 / 60);
      F.group.updateMatrixWorld(true);
      rig.twistTorso(0, 0);
      F.root.updateMatrixWorld(true);
      S.sample();
      S.topOfUpper();
      if (i >= 60) live = Math.max(live, S.topNow - F.group.matrixWorld.elements[13]);
    }
    ok(Math.abs(clipDeep - live) < 0.01 && clipDeep >= deep - 1e-9, `the crouch's head read off the crouched walk's own keys (${cm(clipDeep)} cm) is the live pose's highest top over its cycle (${cm(live)} cm) within 1 cm, and never under the live read's held value (${cm(deep)} cm, which falls back between the cycle's tops)`);
    ok(Number.isNaN(rig.posedHighest(['mx_no_such_clip'], 8, () => 1)), 'a rig with none of the clips answers nothing (the live read then)');
    for (const fps of RATES) {
      const o = walkO;
      const high = await beam(1.5, fps, true, false, o.over, o.ahead, o.r, clipDeep);
      ok(high.passed && !high.lay && high.worst <= 0.005, `@${fps}: with the crouch's head known, a 1.5 m beam is ducked under, never lain down for (${high.lay ? 'lay down' : 'stayed up'}, the drawn top ${cm(Math.max(0, high.worst))} cm past the skin)`);
      const low = await beam(1.2, fps, true, false, o.over, o.ahead, o.r, clipDeep);
      ok(low.passed && low.lay && low.worst <= 0.005, `@${fps}: and a 1.2 m beam is lain down for on the first pass, the drawn head out of it (${cm(Math.max(0, low.worst))} cm past the skin)`);
      // A taller figure's crouch carries the head higher (the browser's human male read 1.50 m): a beam the duck passes bent, over
      // the crouch's own band (`crouchAt` and the room over the capsule), is still ducked under, and one under it lain down for.
      const tallHigh = await beam(1.5, fps, true, false, o.over, o.ahead, o.r, 1.5);
      ok(tallHigh.passed && !tallHigh.lay && tallHigh.worst <= 0.005, `@${fps}: a crouch's head of 1.5 m: a 1.5 m beam ducked under bent, never lain down for (${tallHigh.lay ? 'lay down' : 'stayed up'}, the drawn top ${cm(Math.max(0, tallHigh.worst))} cm past the skin)`);
      const tallLow = await beam(1.2, fps, true, false, o.over, o.ahead, o.r, 1.5);
      ok(tallLow.passed && tallLow.lay && tallLow.worst <= 0.005, `@${fps}: ... and a 1.2 m beam lain down for, the drawn head out of it (${cm(Math.max(0, tallLow.worst))} cm past the skin)`);
    }
  }
  const walkOver = walkO.over;
  const runOver = runO.over;
  ok(walkOver > 0.03 && walkOver < 0.25 && runOver > 0.03 && runOver < 0.25, `the human male's drawn top stands over his standing capsule by ${cm(walkOver)} cm walking and ${cm(runOver)} cm running (the head the duck must keep under a beam)`);
  for (const fps of RATES) {
    let bad = 0;
    let badOff = 0;
    let n = 0;
    let passed = 0;
    let laid = 0;
    const top = 1.6 + Math.max(walkOver, runOver);
    for (let under = Math.round(top * 100) / 100; under >= 0.95; under -= 0.05) {
      for (const run of [false, true]) {
        const over = run ? runOver : walkOver;
        const o = run ? runO : walkO;
        const on = await beam(under, fps, true, run, over, o.ahead, o.r, deep);
        const off = await beam(under, fps, false, run, over, o.ahead, o.r, deep);
        n++;
        if (on.passed) passed++;
        else note(`@${fps} ${run ? 'run' : 'walk'} under ${under.toFixed(2)}: not past the beam in 6 s (${on.lay ? 'lay down' : 'never lay down'})`);
        if (on.lay) laid++;
        if (on.worst > 0.005) {
          bad++;
          note(`@${fps} ${run ? 'run' : 'walk'} under ${under.toFixed(2)}: the drawn top ${cm(on.worst)} cm into the beam's skin`);
        }
        if (off.worst > 0.005) badOff++;
      }
    }
    ok(bad === 0, `@${fps}: under beams lowered 5 cm at a time from the standing head's top (${top.toFixed(2)} m) to 0.95 m, walking and running (${n} walks), the capsule's top and the drawn top over it never past the beam's underside less ${MOVE_TUNE.headSkin} m ('before': ${badOff} walks with the head in the beam)`);
    ok(passed === n, `@${fps}: ... and the body passes under every one, ducking, crouching or lying down (${passed} of ${n}; ${laid} lay down)`);
  }
  // The head's measure caught between two shapes (a lie-down's first frame, a pose not yet the capsule's) never runs away.
  ok(headOverHeld(5, 0, 1, 0, 1 / 60) === HEAD_OVER_MOST, `the drawn top over the capsule's is held to ${HEAD_OVER_MOST} m, so a pose caught between two shapes never sends the duck away`);
}// The 'before' setting's duck: no head read (the capsule's own clearance).
resetMoveTune();
tuneMove({ duckHead: 'before' });
ok(MOVE_TUNE.duckHead === 'before', "duckHead's other setting is the smoothness round's duck");

// ---- 4. the game's own glue, pinned -----------------------------------------------------------------------------------------
{
  const P = readFileSync(new URL('../../../src/player/player.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/this\.ledge\.limbsFor\(lp, rig, toPhys\);\n    this\.clearFigure\(lp, toPhys\);\n    lp\.filter = this\.moveFilter\(\);\n    lp\.place\(rig, this\.physics\.world, toPhys\);\n    this\.settleFigure\(lp, toPhys\);/.test(P), "the hang's limbs: the line-up, the spheres' push, the solves, the settle (the player's `placeHangLimbs`)");
  ok(/this\.wall\.limbsFor\(lp, rig, this\.physics\.world as unknown as LedgeWorld, toPhys\);\n    this\.clearFigure\(lp, toPhys\);\n    lp\.place\(rig, this\.physics\.world, toPhys\);\n    this\.settleFigure\(lp, toPhys\);/.test(P), "the wall's limbs the same (the player's `placeWallLimbs`)");
  ok(P.includes('clearClimb(S, lp, rig, this.physics.world as unknown as SphereWorld, this.moveFilter(), this.clearDt, this.pos.x, this.pos.y + this.colliderOffsetY, this.pos.z,'), "the push handed the body's capsule's middle as where out is");
  ok(P.includes('S.headFeet = this.pos.y;\n      S.headTall = this.shape.tall;\n      S.headDt = dt;\n      S.holdHead();\n      if (S.topNow === S.topNow) this.shapeIn.headOver = S.headHeld;'), 'the drawn top handed to the duck through the game\'s own `holdHead`');
  ok(P.includes('this.duckFigure(dt, rig, ducks && (this.shape.share > 0 || this.shape.bend > 0));'), 'the duck\'s figure stepped after the pose, every frame on the feet');
  ok(P.includes('if (head && this.deepRig !== rig) this.measureDeep(rig);\n    rig.root.updateMatrixWorld(true);\n    S.sample();') && P.includes("const measure = () => {\n      S.sample();\n      S.topOfUpper();\n      return S.topNow - root.matrixWorld.elements[13];\n    };\n    this.deepClip = rig.posedHighest(deepClipsOf(rig), DEEP_SAMPLES, measure);"), "the crouch's head read off its clips once a rig, before the frame's own sample, by the game's own `posedHighest` (as above)");
  ok(P.includes('(this.crouching || this.shape.share >= DEEP_SHARE || this.shape.bend > 0);\n    this.deepFor = deep ? this.deepFor + dt : 0;\n    const standing = STAND_TALL + S.headHeld;\n    if (head && this.deepClip === this.deepClip) this.shapeIn.deepHead = Math.min(this.deepClip, standing);\n    else if (deep && this.deepFor >= DEEP_SETTLE) {\n      S.headFeet = this.pos.y;\n      S.headDt = dt;\n      S.holdDeep();\n      if (S.deepHeld > 0) this.shapeIn.deepHead = Math.min(S.deepHeld, standing);'), 'the drawn top at the duck\'s deepest handed to the duck: the clips\' read where there is one, else the game\'s own `holdDeep` once settled, never over the standing head');
  const Sh = readFileSync(new URL('../../../src/player/bodyShape.ts', import.meta.url), 'utf8');
  ok(Sh.includes('const top = Math.max(T.proneUnder + this.clrExtra, this.lieTop) - ROOF_SKIN;'), 'a roof under the crouched walk\'s head lays the body down (the roof probe\'s top)');
  ok(/const sphereSrc = rig\.character \? sphereSourceOf\(rig\.character\.bodyMeshes\(\)\) : null;\n    this\.spheres\.use\(rig, sphereSrc \? measureSpheres\(sphereSrc\) : \[\]\);/.test(P), "the spheres measured off the attached rig's own body meshes");
  const F = readFileSync(new URL('./climbFigure.ts', import.meta.url), 'utf8');
  ok(F.includes('clearClimb(S, F.lp, F.rig as never, b.physics.world as never, b.filter, dt, b.pos.x, b.pos.y + b.colliderOffsetY, b.pos.z,') && F.includes('settleClimb(F.spheres, F.lp, F.rig as never, b.physics.world as never, b.filter);'), "the tests' figure calls the very functions the player does");
}
resetClimbTune();
resetMoveTune();
void BodySpheres;
void CLIMB_TUNE;
console.log(`smooth2Body: ${checks} checks passed`);
