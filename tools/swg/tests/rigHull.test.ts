// A shuttle's travel rig built as a hull that can fly (src/vehicles/rigHull.ts, src/world/rigPath.ts).
//
// The one claim everything rests on is that the hull flown in the world and the rig drawn from the clock
// put every vertex of every piece in the same place at the same moment of the same clip, so the one can
// be swapped for the other on a pad and nobody sees it. That is checked vertex by vertex, twice: on a rig
// made up here with the transport's own awkward rest turn, which runs on any machine, and on the game's
// own rigs when this install has converted them. Beside it, the def a crossing carries, the guards
// that keep such a hull out of every fight and every crash, which are read out of vehicle.ts as text
// because node cannot load that file, and the garage's framing of such a hull, read out of garage.ts
// the same way for the same reason.
//
// Run: node tools/swg/tests/rigHull.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { loadGlb, madeUpPieces, madeUpRig, madeUpRigBlock, packRigs, type Pieces, type Skeleton } from './rigFixtures.ts';
import { RIG_HULL_TUNE, RigHull, assembleRigModel, hullJointOf, pieceVolumes, rigDef, rigExtents } from '../../../src/vehicles/rigHull.ts';
import { frameExtents } from '../../../src/vehicles/shipAssembly.ts';
import { chainPose, onPad, poseRigAction, vehicleFromJoint, type Pad, type RigActions } from '../../../src/world/rigPath.ts';
import { joinsTheFight } from '../../../src/space/shipCombat.ts';
import type { RigClips, RigPose, TravelRig } from '../../../src/world/travelTerminal.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}
const show = (v: THREE.Vector3) => v.toArray().map((n) => n.toFixed(3)).join(', ');

// ---------------------------------------------------------------- the clock rig and the flown hull, side by side

/** A rig stood as ShuttleRigs stands one: the skeleton cloned under a group on the pad, the pieces hung, the whole clips on a mixer. */
function clockRig(skeleton: Skeleton, pieces: Pieces, clips: RigClips, pad: Pad): { root: THREE.Group; pieces: THREE.Object3D[]; state: RigActions } {
  const root = new THREE.Group();
  root.position.set(pad.x, pad.y, pad.z);
  root.rotation.y = pad.yaw;
  const joints = skeleton.scene.clone(true);
  root.add(joints);
  const hung: THREE.Object3D[] = [];
  for (const p of pieces) {
    const copy = p.model.clone(true);
    joints.getObjectByName(p.joint)!.add(copy);
    hung.push(copy);
  }
  const mixer = new THREE.AnimationMixer(joints);
  const actions: RigActions['actions'] = {};
  for (const role of ['land', 'lift', 'ground', 'sky'] as const) {
    const clip = clips[role] ? skeleton.animations.find((a) => a.name === clips[role]) : undefined;
    if (!clip) continue;
    const a = mixer.clipAction(clip);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    actions[role] = a;
  }
  return { root, pieces: hung, state: { mixer, actions, current: null } };
}

/**
 * A rig built as the garage builds a shuttle's hull (`Garage.rigModel`): assembled, then posed on the
 * ground and framed on its real vertices by `RigHull.frame`, the very call the garage makes (which the
 * text check further down holds it to), in a vehicle's group.
 */
function flownHull(skeleton: Skeleton, pieces: Pieces, hullJoint: string, clips: RigClips) {
  const copies = pieces.map((p) => ({ joint: p.joint, model: p.model.clone(true) }));
  const assembled = assembleRigModel({ scene: skeleton.scene.clone(true), animations: skeleton.animations }, copies, hullJoint, clips);
  const hull = new RigHull(assembled, clips);
  // How far under its feet the framing every other machine takes (each piece's own box turned) would
  // stand it, measured on the ground pose before it is framed.
  hull.pose('ground', 0);
  assembled.model.updateMatrixWorld(true);
  const real = rigExtents(assembled.model)!;
  const looseBy = real.minY - (frameExtents(assembled.model, () => true)?.minY ?? real.minY);
  const f = hull.frame()!;
  const group = new THREE.Group();
  group.add(assembled.model);
  return { assembled, hull, group, pieces: copies.map((c) => c.model), frame: f, looseBy };
}

const jPos = new THREE.Vector3();
const jQuat = new THREE.Quaternion();

/** The flown hull held where the clock has its hull joint: P = Pad × J(t) × T(offset), its limbs posed from the stripped clip. */
function holdFlown(f: ReturnType<typeof flownHull>, skeleton: Skeleton, clips: RigClips, pad: Pad, role: RigPose['role'], t: number): void {
  if (role === 'ground') {
    jPos.copy(f.hull.ground.pos);
    jQuat.copy(f.hull.ground.quat);
  } else {
    const clip = skeleton.animations.find((a) => a.name === clips[role])!;
    chainPose(f.assembled.chain, clip, t, jPos, jQuat);
  }
  onPad(pad, jPos, jQuat);
  vehicleFromJoint(jPos, jQuat, f.hull.offset, f.group.position);
  f.group.quaternion.copy(jQuat);
  f.hull.pose(role, t);
  f.group.updateMatrixWorld(true);
}

/** The farthest any vertex of any piece stands between the clock rig and the flown hull, with where it was. */
function worstGap(clock: THREE.Object3D[], flown: THREE.Object3D[], every = 1): number {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  let worst = 0;
  clock.forEach((piece, i) => {
    const meshesA: THREE.Mesh[] = [];
    const meshesB: THREE.Mesh[] = [];
    piece.traverse((o) => (o as THREE.Mesh).isMesh && meshesA.push(o as THREE.Mesh));
    flown[i].traverse((o) => (o as THREE.Mesh).isMesh && meshesB.push(o as THREE.Mesh));
    assert.equal(meshesA.length, meshesB.length);
    meshesA.forEach((m, k) => {
      const pos = m.geometry.getAttribute('position');
      for (let v = 0; v < pos.count; v += every) {
        a.fromBufferAttribute(pos, v).applyMatrix4(m.matrixWorld);
        b.fromBufferAttribute(pos, v).applyMatrix4(meshesB[k].matrixWorld);
        worst = Math.max(worst, a.distanceTo(b));
      }
    });
  });
  return worst;
}

// ---------------------------------------------------------------- a rig made up here

// `madeUpRig` (rigFixtures.ts): the transport's own awkward rest turn, a strut that slides and a door that swings.
const clips = madeUpRigBlock.moods[''];

{
  const skeleton = madeUpRig();
  const assembled = assembleRigModel({ scene: skeleton.scene.clone(true), animations: skeleton.animations }, madeUpPieces(), 'hold', clips);
  assembled.model.updateMatrixWorld(true);
  const at = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  assembled.joints.getObjectByName('hold')!.matrixWorld.decompose(at, turn, new THREE.Vector3());
  ok(at.length() < 1e-6 && turn.angleTo(new THREE.Quaternion()) < 1e-6, `the carrier puts the hull joint at the model's origin with no turn, whatever the root's rest turn (${show(at)}, ${turn.angleTo(new THREE.Quaternion()).toExponential(1)} rad)`);
  ok(assembled.chain.map((c) => c.name).join(',') === 'root,hold', 'the chain is the hull joint and every joint above it, top first');
  const chainTrack = (t: THREE.KeyframeTrack) => ['root', 'hold'].includes(t.name.slice(0, t.name.lastIndexOf('.')));
  const everyLimb = skeleton.animations.every((a) => {
    const limbs = assembled.limbClips.get(a.name)!;
    return !limbs.tracks.some(chainTrack) && limbs.tracks.length === a.tracks.filter((t) => !chainTrack(t)).length && limbs.duration === a.duration;
  });
  ok(everyLimb, "the limbs' clips keep every track but the chain's, and the clip's own length");
  ok(assembled.fullClips.get('land') === skeleton.animations[0], 'and the whole clips are kept as they are');

  // The limbs relative to the hull joint: the stripped clip on the pinned hull against the whole clip on a clock rig.
  const hull = new RigHull(assembled, clips);
  const clock = clockRig(skeleton, madeUpPieces(), clips, { x: 0, y: 0, z: 0, yaw: 0 });
  let worst = 0;
  const rel = new THREE.Matrix4();
  const relB = new THREE.Matrix4();
  for (const [role, t] of [['land', 0], ['land', 7.5], ['land', 10], ['lift', 0.5], ['lift', 4], ['ground', 0]] as const) {
    poseRigAction(clock.state, role, t);
    clock.root.updateMatrixWorld(true);
    hull.pose(role, t);
    assembled.model.updateMatrixWorld(true);
    const Jc = clock.root.getObjectByName('hold')!.matrixWorld;
    const Jf = assembled.joints.getObjectByName('hold')!.matrixWorld;
    for (const limb of ['hold_strut', 'hold_door']) {
      rel.copy(Jc).invert().multiply(clock.root.getObjectByName(limb)!.matrixWorld);
      relB.copy(Jf).invert().multiply(assembled.joints.getObjectByName(limb)!.matrixWorld);
      for (let i = 0; i < 16; i++) worst = Math.max(worst, Math.abs(rel.elements[i] - relB.elements[i]));
    }
  }
  ok(worst < 1e-6, `the strut and the door stand where the whole clip has them relative to the hull joint, at every moment tried (${worst.toExponential(1)})`);
  ok(hullJointOf(madeUpRigBlock) === 'hold', "the hull joint is the one the biggest piece hangs on, by the pack's bounds whichever corner it wrote first");
  const noBounds: TravelRig = { ...madeUpRigBlock, parts: madeUpRigBlock.parts.map(({ bounds: _b, ...p }) => p) };
  ok(hullJointOf(noBounds, pieceVolumes(madeUpPieces())) === 'hold', "and by the pieces' own volumes when the pack gives no bounds");
}

{
  // Swap equality: every vertex of every piece, the clock rig stood on a turned pad against the hull
  // framed as the garage frames it and held at P = Pad × J(t) × T(offset).
  const skeleton = madeUpRig();
  const pad: Pad = { x: 1234.5, y: 17.25, z: -987.25, yaw: 2.1 };
  const clock = clockRig(skeleton, madeUpPieces(), clips, pad);
  const flown = flownHull(skeleton, madeUpPieces(), 'hold', clips);
  let worst = 0;
  let where = '';
  for (const [role, t] of [['ground', 0], ['land', 0.5], ['land', 5], ['land', 9.2], ['land', 10], ['lift', 0], ['lift', 1.5], ['lift', 3.3], ['lift', 6]] as const) {
    poseRigAction(clock.state, role, t);
    clock.root.updateMatrixWorld(true);
    holdFlown(flown, skeleton, clips, pad, role, t);
    const gap = worstGap(clock.pieces, flown.pieces);
    if (gap > worst) {
      worst = gap;
      where = `${role} at ${t} s`;
    }
  }
  ok(worst <= 1e-5, `the flown hull puts every vertex where the clock rig does, on a turned pad, on the ground and all through both clips (worst ${worst.toExponential(1)} m${where ? `, ${where}` : ''})`);
  const g = new THREE.Vector3();
  const gq = new THREE.Quaternion();
  chainPose(flown.assembled.chain, skeleton.animations.find((a) => a.name === 'loop_ground')!, 0, g, gq);
  ok(g.distanceTo(flown.hull.ground.pos) < 1e-9 && gq.angleTo(flown.hull.ground.quat) < 1e-9, "the ground pose it is parked at is the hull joint's on the ground clip");
  // The ramp's foot, worked out again from the door's own vertices with the hull parked at the vehicle's origin.
  flown.group.position.set(0, 0, 0);
  flown.group.quaternion.identity();
  flown.hull.pose('ground', 0);
  flown.group.updateMatrixWorld(true);
  const doorPoints: THREE.Vector3[] = [];
  flown.pieces[2].traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) doorPoints.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
  });
  // Framed on its real vertices: parked, its lowest vertex is on the vehicle's floor and its vertices' box is centred on its origin.
  const all = new THREE.Box3();
  for (const piece of flown.pieces) {
    piece.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) all.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
    });
  }
  ok(Math.abs(all.min.y) < 1e-6 && Math.abs(all.min.x + all.max.x) < 1e-6 && Math.abs(all.min.z + all.max.z) < 1e-6, `framed, it stands on its lowest real vertex and is centred on its real vertices, not on its pieces' turned boxes (floor ${all.min.y.toExponential(1)} m)`);
  const lowest = Math.min(...doorPoints.map((p) => p.y));
  const farthest = Math.max(...doorPoints.filter((p) => p.y - lowest < 0.05).map((p) => Math.abs(p.x)));
  const foot = flown.hull.rampFoot;
  ok(!!foot && Math.abs(foot.y - lowest) < 1e-6 && Math.abs(Math.abs(foot.x) - farthest) < 1e-6, `a rig with a door has its ramp's foot at the door's lowest point farthest out, in the vehicle's frame (${foot ? show(foot) : 'none'})`);
  const noDoor = flownHull(skeleton, madeUpPieces().filter((p) => p.joint !== 'hold_door'), 'hold', clips);
  ok(noDoor.hull.rampFoot === null, 'and one with no door has none');
  ok(flown.hull.offset.distanceTo(new THREE.Vector3(flown.frame.cx, flown.frame.minY, flown.frame.cz)) < 1e-9, "the offset is minus where the framing stood the model, the hull joint's place in the vehicle");
  ok(flown.assembled.model.position.clone().add(flown.hull.offset).length() < 1e-12, "so the hull joint stands at minus the offset in the vehicle, and the offset is the vehicle's origin in the joint's frame");
  // Framed once more from where it now stands, it stays put: the framing is measured, not added up.
  const stoodAt = flown.assembled.model.position.clone();
  flown.hull.frame();
  ok(flown.assembled.model.position.distanceTo(stoodAt) < 1e-6, 'and framing a hull already framed moves it nowhere');
  flown.hull.dispose();
}

{
  // A box's corners are its vertices, so on the made-up rig a piece's turned box and its real vertices
  // agree and the two framings cannot be told apart. A gem turned 45 degrees about z tells them apart:
  // its vertices reach 0.71 m below its joint, its own box turned reaches 1.41 m.
  const scene = new THREE.Group();
  const joint = new THREE.Bone();
  joint.name = 'hold';
  joint.position.set(2, 5, -1);
  scene.add(joint);
  const gem = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(1), new THREE.MeshBasicMaterial());
  mesh.rotation.z = Math.PI / 4;
  gem.add(mesh);
  const still: RigClips = { land: 'land', lift: 'land', ground: 'land' };
  const assembled = assembleRigModel({ scene, animations: [new THREE.AnimationClip('land', 1, [])] }, [{ joint: 'hold', model: gem }], 'hold', still);
  const hull = new RigHull(assembled, still);
  const f = hull.frame();
  const loose = frameExtents(assembled.model, () => true);
  ok(!!f && Math.abs(hull.offset.y + Math.SQRT1_2) < 1e-6 && Math.abs(hull.offset.x) < 1e-6 && Math.abs(hull.offset.z) < 1e-6, `a hull is framed on its pieces' real vertices, so a turned piece stands on its lowest vertex (${show(hull.offset)})`);
  ok(!!loose && loose.minY < -0.7, `where the framing other machines take would have stood it ${loose ? (-loose.minY).toFixed(2) : '?'} m under its own feet`);
  hull.dispose();
}

// ---------------------------------------------------------------- the def

{
  const def = rigDef('transport', madeUpRigBlock, 'calm');
  const copy = structuredClone(def);
  assert.deepEqual(copy, def);
  ok(copy.source === 'rig' && copy.kind === 'ship' && copy.id === 'rig:transport:calm' && copy.file === 'assets-private/travel/rig.glb', 'a rig def is a ship from the rig source, named for its rig and branch, on the rig file');
  ok(copy.rig?.hull === 'hold' && copy.rig.mood === 'calm' && copy.rig.rig.parts.length === 3, 'it carries its whole rig block, its branch and its hull joint by value, and survives a structured clone equal');
  ok(rigDef('shuttle', madeUpRigBlock, '').id === 'rig:shuttle:default', 'a rig with one unnamed branch is its default');
  ok(!joinsTheFight({ spec: { ship: true }, disposed: false, invulnerable: true }), 'a hull built from it, which is invulnerable, never joins the fight');
  ok(RIG_HULL_TUNE.boostSpeed < 399 && RIG_HULL_TUNE.maxSpeed < RIG_HULL_TUNE.boostSpeed, 'its handling stays under what the physics will move a body at');
}

// ---------------------------------------------------------------- the guards in vehicle.ts, read as text

{
  // vehicle.ts cannot be loaded here (a constructor parameter property, extensionless imports), so the
  // guards are read off its text: each way a hull is hurt asks `invulnerable` before it touches anything,
  // every crash it records is nought for such a hull, and flyShip's three ground rules stand aside for a
  // hull whose pilot keeps its own line.
  const text = readFileSync(new URL('../../../src/vehicles/vehicle.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const bodyOf = (sig: RegExp): string => {
    const m = sig.exec(text);
    assert.ok(m, `vehicle.ts has ${sig}`);
    const start = m.index + m[0].length;
    const end = text.indexOf('\n  }\n', start);
    return text.slice(start, end);
  };
  for (const [name, sig] of [
    ['damage', /\n {2}damage\([^\n]*\{\n/],
    ['takeBolt', /\n {2}takeBolt\([^\n]*\{\n/],
    ['hurtHull', /\n {2}private hurtHull\([^\n]*\{\n/],
    ['rammed', /\n {2}private rammed\([^\n]*\{\n/],
  ] as const) {
    const body = bodyOf(sig);
    const guard = body.indexOf('this.invulnerable');
    const touches = ['this.struck', 'this.hp', 'this.justHit', 'this.keptHit', 'this.combat', 'this.hurtHull', 'this.cruise'].map((t) => body.indexOf(t)).filter((i) => i >= 0);
    ok(guard >= 0 && touches.every((i) => guard < i) && /^\s*(\/\/[^\n]*\n\s*)*if \(this\.invulnerable/.test(body), `${name} asks whether the hull is invulnerable first, before it touches anything`);
  }
  const crashes = [...text.matchAll(/this\.crashed = ([^;]*);/g)].map((m) => m[1]);
  ok(crashes.length >= 2 && crashes.every((c) => c === '0' || c.startsWith('this.invulnerable ? 0 :')), `every crash a hull records is nought for one nothing may hurt (${crashes.length} places)`);
  const fly = bodyOf(/\n {2}private flyShip\([^\n]*\{\n/);
  ok(/if \(!this\.groundByPilot\) \{\n\s*let toGround/.test(fly), "flyShip's ease off the ground and the ceiling stands aside for a hull whose pilot keeps its own line");
  ok(/if \(!this\.groundByPilot && \(inGround \|\|/.test(fly), 'and so does its crash into the ground');
  ok(/if \(!this\.groundByPilot && !this\.space && h < s\.fly!\.floor \+ 0\.5 && tmp\.y < 0\) tmp\.y = 0;/.test(fly), 'and the floor it will not let a sinking hull through');
}

// ---------------------------------------------------------------- the garage's framing, read as text

{
  // garage.ts cannot be loaded here either, so the one thing the offsets pinned below depend on is read
  // off its text: a rig's hull is framed by `RigHull.frame`, the call the test's own hull is framed by,
  // and never by the framing every other machine takes, which would stand the transport 0.77 m under its
  // own feet and move its offset and its ramp's foot with it. Both ways a rig is built go through it.
  const text = readFileSync(new URL('../../../src/vehicles/garage.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const bodyOf = (sig: RegExp): string => {
    const m = sig.exec(text);
    assert.ok(m, `garage.ts has ${sig}`);
    const start = m.index + m[0].length;
    return text.slice(start, text.indexOf('\n  }\n', start));
  };
  const model = bodyOf(/\n {2}private async rigModel\([^\n]*\{\n/);
  const built = model.indexOf('new RigHull(');
  const framed = model.indexOf('hull.frame()');
  ok(built >= 0 && framed > built && !model.includes('frameModel(') && !model.includes('.position.'), "the garage frames a rig's hull through RigHull.frame, after it is built, and moves it by nothing else");
  ok(/model\.userData\.reach = f\.reach/.test(model) && /bounds[^\n]*f \? \{ min: \[-f\.halfW, 0, -f\.halfL\], max: \[f\.halfW, f\.h, f\.halfL\] \}/.test(model), "and takes its box and reach from what that framing measured, in frameModel's shapes");
  ok(bodyOf(/\n {2}private async spawnRig\([^\n]*\{\n/).includes('await this.rigModel(def)') && bodyOf(/\n {2}async rigReport\([^\n]*\{\n/).includes('await this.rigModel(def)'), 'and the hull it flies and the one the console reports are both built that way');
  ok(/\n {2}async spawn\([^\n]*\{\n {4}if \(def\.source === 'rig'\) return this\.spawnRig\(/.test(text), "and spawning a rig's def goes there before anything else a spawn does");
}

// ---------------------------------------------------------------- the game's own rigs, if this install has them

{
  const packs = join(process.cwd(), 'assets-private');
  const convert = 'npm run swg -- travel @SWG assets-private --retail-only';
  // Every rig any converted world's travel pack carries, by name: the rigs live in one folder every
  // world shares, but a world carries only the ones its ports stand (Dantooine, Dathomir, Endor, Lok and
  // Yavin 4 carry the transport alone), so one world's pack could leave a rig out with nothing to say so.
  const rigs = packRigs(packs, readdirSync, existsSync, join);

  const want: Record<string, { hull: string; offset: [number, number, number]; eps: number }> = {
    shuttle: { hull: 'root', offset: [0, 0, 2.33], eps: 0.05 },
    transport: { hull: 'hold_transport', offset: [0, -4.0, 0.83], eps: 0.02 },
  };
  if (!Object.keys(rigs).length) note(`no converted world's travel pack carries rigs, so the game's own rigs are not checked: ${convert}`);
  else {
    for (const name of Object.keys(want)) if (!rigs[name]) note(`${name}: no converted world's travel pack carries this rig, so its hull joint, offset and swap are not checked: ${convert}`);
    const pad: Pad = { x: 1234.5, y: 17.25, z: -987.25, yaw: 2.1 };
    for (const [name, rig] of Object.entries(rigs)) {
      if (!existsSync(join(packs, rig.file)) || !rig.parts.every((p) => existsSync(join(packs, p.file)))) {
        note(`${name}: its rig's files are not converted, so it is not checked: ${convert}`);
        continue;
      }
      const skeleton = loadGlb(join(packs, rig.file));
      const pieces = rig.parts.map((p) => ({ joint: p.joint, model: loadGlb(join(packs, p.file)).scene as THREE.Object3D }));
      const hullJoint = hullJointOf(rig);
      if (want[name]) ok(hullJoint === want[name].hull, `${name}: its hull joint is ${hullJoint}`);
      ok(hullJointOf({ ...rig, parts: rig.parts.map(({ bounds: _b, ...p }) => p) }, pieceVolumes(pieces)) === hullJoint, `${name}: and the pieces' own volumes say the same with the pack's bounds taken away`);
      for (const [mood, c] of Object.entries(rig.moods)) {
        const label = `${name}${mood ? ` ${mood}` : ''}`;
        const flown = flownHull(skeleton, pieces, hullJoint, c);
        const clock = clockRig(skeleton, pieces, c, pad);
        let worst = 0;
        let where = '';
        const moments: [RigPose['role'], number[]][] = [['ground', [0]], ['lift', [0, 3, 7.5, 12, 18]], ['land', [0.5, 8.2, 15, 22, 26]]];
        for (const [role, times] of moments) {
          const clip = role === 'ground' ? null : skeleton.animations.find((a) => a.name === c[role]);
          for (const t of times) {
            if (clip && t > clip.duration) continue;
            poseRigAction(clock.state, role, t);
            clock.root.updateMatrixWorld(true);
            holdFlown(flown, skeleton, c, pad, role, t);
            const gap = worstGap(clock.pieces, flown.pieces);
            if (gap > worst) {
              worst = gap;
              where = `${role} at ${t} s`;
            }
          }
        }
        ok(worst <= 2e-3, `${label}: the flown hull puts every vertex within 2 mm of the clock rig's, on the ground and through both clips (worst ${(worst * 1000).toFixed(2)} mm, ${where})`);
        if (want[name]) {
          const w = new THREE.Vector3(...want[name].offset);
          ok(flown.hull.offset.distanceTo(w) <= want[name].eps * Math.sqrt(3), `${label}: the vehicle's origin stands at ${show(flown.hull.offset)} in its hull joint's frame, as measured (${show(w)}), so the joint stands at minus that in the vehicle`);
        }
        // Why a rig is framed on its vertices: every other machine's framing measures each piece's own box turned.
        note(`${label}: framed on its pieces' turned boxes, as other machines are, it would stand ${flown.looseBy.toFixed(3)} m under its own feet`);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(flown.hull.ground.quat);
        const tilt = THREE.MathUtils.radToDeg(up.angleTo(new THREE.Vector3(0, 1, 0)));
        ok(tilt < 1, `${label}: parked, its hull joint stands level (${tilt.toFixed(2)}°)`);
        if (name === 'transport') ok(!!flown.hull.rampFoot && flown.hull.rampFoot.distanceTo(new THREE.Vector3(7.22, 0.16, 8.96)) < 0.1, `${label}: its ramp's foot is at ${flown.hull.rampFoot ? show(flown.hull.rampFoot) : 'nowhere'} in the vehicle's frame, as measured (7.22, 0.16, 8.96)`);
        if (name === 'shuttle') ok(flown.hull.rampFoot === null, `${label}: the shuttle has no door and no ramp's foot`);
        flown.hull.dispose();
      }
    }
  }
}

console.log(`\nrig hull: ${passed} checks passed`);
