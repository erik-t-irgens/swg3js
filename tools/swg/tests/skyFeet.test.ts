// Two small fixes of 2026-11-16, the owner's asks, run without a renderer:
//  1. The planet's sun, moons and pictures stand in the sky upright to the horizon and never turn with the camera
//     (`src/world/skyBodies.ts`), where a THREE.Sprite stayed upright on the screen and so spun against the sky as the
//     view turned under it. Held: the quad faces the camera, its picture's top points along the sky toward the zenith,
//     looked at straight on it is exactly what the sprite drew, and what the sprite drew moved with the camera.
//  2. A footprint lands under the foot that landed and points the way that foot points (`footAt` in
//     `src/world/footprints.ts`), read off the body's own ankle and toe joints, for a rig that hands them by name and a
//     model walked for them alike; a body with no ankles, or the rule 'body', keeps the rule of before to the bit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { makeSkyBody, turnSkyBody } from '../../../src/world/skyBodies.ts';
import { footAt, FootAt, Footprints, PRINT_TUNE, facingOf, sideOf, slopeStep, stanceOffset, type PrintMark } from '../../../src/world/footprints.ts';
import type { FootGround, FootStep } from '../../../src/audio/footsteps.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

// ---- 1. the sky's bodies ----
{
  const q = new THREE.Quaternion();
  const ax = new THREE.Vector3();
  const ay = new THREE.Vector3();
  const az = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let faces = true;
  let upright = true;
  let unit = true;
  let asSprite = true;
  const cam = new THREE.PerspectiveCamera();
  const camInv = new THREE.Quaternion();
  for (let el = -20; el <= 85; el += 5) {
    for (let az0 = 0; az0 < 360; az0 += 15) {
      const e = THREE.MathUtils.degToRad(el);
      const a = THREE.MathUtils.degToRad(az0);
      dir.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
      turnSkyBody(dir, q);
      ax.set(1, 0, 0).applyQuaternion(q);
      ay.set(0, 1, 0).applyQuaternion(q);
      az.set(0, 0, 1).applyQuaternion(q);
      // Its face toward the camera (the sky group's origin), its right level, its top up the sky.
      faces &&= close(az.x, -dir.x) && close(az.y, -dir.y) && close(az.z, -dir.z);
      upright &&= close(ax.y, 0) && ay.y > 0 && close(ay.dot(dir), 0);
      unit &&= close(ax.length(), 1) && close(ay.length(), 1) && close(ax.dot(ay), 0);
      // Looked at straight on with the view level (the camera's own lookAt, up +Y), its axes are the screen's: what a
      // sprite always drew.
      cam.position.set(0, 0, 0);
      cam.up.set(0, 1, 0);
      cam.lookAt(dir);
      camInv.copy(cam.quaternion).invert();
      const sx = ax.clone().applyQuaternion(camInv);
      const sy = ay.clone().applyQuaternion(camInv);
      asSprite &&= close(sx.x, 1, 1e-6) && close(sy.y, 1, 1e-6);
    }
  }
  ok(faces, 'every body faces the camera at the sky group\'s origin, from 20 degrees under the horizon to 85 over, all round');
  ok(upright, 'and stands upright to the horizon: its right level, its top along the sky toward the zenith');
  ok(unit, 'its axes stay a proper turn (unit, square)');
  ok(asSprite, 'looked at straight on with the view level, it is exactly what the sprite drew');

  // The sprite stays upright on the screen, so a body 75 degrees up seen with the camera turned 90 degrees under it has
  // its picture's top swung round the sky; the quad's never moves, since nothing of the camera is asked.
  dir.set(0, Math.sin(THREE.MathUtils.degToRad(75)), -Math.cos(THREE.MathUtils.degToRad(75)));
  const spriteTop = (yawDeg: number): THREE.Vector3 => {
    const c = new THREE.PerspectiveCamera();
    c.rotation.order = 'YXZ';
    c.rotation.set(THREE.MathUtils.degToRad(60), THREE.MathUtils.degToRad(yawDeg), 0);
    c.updateMatrixWorld();
    // A sprite's top is the camera's up, carried into the world.
    return new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion);
  };
  const a = spriteTop(0);
  const b = spriteTop(90);
  ok(a.angleTo(b) > 1, `before: the sprite's top swung ${THREE.MathUtils.radToDeg(a.angleTo(b)).toFixed(0)} degrees round the sky as the view turned 90 degrees under it`);
  turnSkyBody(dir, q);
  const top1 = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  turnSkyBody(dir, q);
  const top2 = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  ok(top1.angleTo(top2) === 0, 'now: the quad\'s top depends on where the body hangs and nothing else');

  // Straight overhead "toward the zenith" has no direction: a level right is kept, and nothing is NaN.
  turnSkyBody(new THREE.Vector3(0, 1, 0), q);
  ok([q.x, q.y, q.z, q.w].every(Number.isFinite) && close(q.length(), 1), 'straight overhead the turn is still a whole, finite turn');

  const body = makeSkyBody(new THREE.Texture(), 700, true);
  ok(body.scale.x === 700 && body.scale.y === 700 && body.material.depthWrite === false && body.material.transparent && body.material.fog === false && body.material.blending === THREE.AdditiveBlending && body.material.userData.unlit === true, 'a body is a 1 m quad scaled to the sprite\'s width, blended as the sprite was, unlit');

  const sky = readFileSync(new URL('../../../src/world/sky.ts', import.meta.url), 'utf8');
  ok(/if \(s\.visible\) turnSkyBody\(dir, s\.quaternion\);/.test(sky) && /makeSkyBody\(tex, \(2 \* size \* SKY_RADIUS\) \/ CELESTIAL_DISTANCE, additive\)/.test(sky) && !/new THREE\.Sprite\(/.test(sky), 'sky.ts builds its bodies as quads, the sprite\'s width, and turns each placed one');
}

// ---- 2. the footprints ----
function step(over: Partial<FootStep> = {}): FootStep {
  return { key: 1, kind: 'player', label: 'human_male', surface: 'sand', from: 'terrain', x: 0, y: 0, z: 0, heading: 0, scale: 1, inside: false, deck: null, ground: null, body: null, ...over };
}
/** A body whose left foot is down at (-0.1, 0.08, 0) pointing +X, and whose right is lifted behind. */
function body(name = (s: string) => s): { root: THREE.Group; lAnkle: THREE.Bone; rAnkle: THREE.Bone } {
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'root';
  root.add(hips);
  const lAnkle = new THREE.Bone();
  lAnkle.name = name('lAnkle');
  lAnkle.position.set(-0.1, 0.08, 0);
  const lToe = new THREE.Bone();
  lToe.name = name('lToe');
  lToe.position.set(0.14, -0.04, 0);
  lAnkle.add(lToe);
  const rAnkle = new THREE.Bone();
  rAnkle.name = name('rAnkle');
  rAnkle.position.set(0.1, 0.25, -0.3);
  const rToe = new THREE.Bone();
  rToe.name = name('rToe');
  rToe.position.set(0, -0.04, 0.14);
  rAnkle.add(rToe);
  hips.add(lAnkle, rAnkle);
  return { root, lAnkle, rAnkle };
}
{
  const out = new FootAt();
  const b = body();
  ok(footAt(step({ body: b.root }), false, out), 'a model walked for its joints gives a foot');
  ok(out.left && close(out.x, -0.1 + 0.07, 1e-6) && close(out.z, 0, 1e-6) && close(out.fx, 1, 1e-6) && close(out.fz, 0, 1e-6), 'the lower ankle is the landing foot, the print half way to its toe, pointing along the foot and not the heading');
  // A body moved and turned: the foot is read in the world.
  b.root.position.set(10, 2, -5);
  b.root.rotation.y = Math.PI / 2;
  b.root.updateMatrixWorld(true);
  ok(footAt(step({ body: b.root, x: 10, y: 2, z: -5, heading: Math.PI / 2 }), false, out) && close(out.x, 10, 1e-6) && close(out.z, -5 + 0.03, 1e-6) && close(out.fx, 0, 1e-6) && close(out.fz, -1, 1e-6), 'a turned body: the foot is where its joints stand in the world');
  // A rig that hands its joints by name, a creature's capitals included.
  const caps = body((s) => s[0].toUpperCase() + s.slice(1));
  const rig = { bone: (n: string) => caps.root.getObjectByName(n) };
  ok(footAt(step({ body: rig }), false, out) && out.left && close(out.fx, 1, 1e-6), 'a rig hands its joints by name, LAnkle as well as lAnkle');
  // Both ankles at one height: the foot the feet would have taken in turn.
  const tie = body();
  tie.rAnkle.position.y = tie.lAnkle.position.y + 0.005;
  ok(footAt(step({ body: tie.root }), false, out) && out.left === false, 'two ankles within the tie: the hint decides (right)');
  ok(footAt(step({ body: tie.root }), true, out) && out.left === true, 'and (left)');
  // Nothing to read: no body, no ankles, a foot implausibly far off.
  const bare = new THREE.Group();
  bare.add(new THREE.Bone());
  ok(!footAt(step(), false, out) && !footAt(step({ body: bare }), false, out), 'no body, or a body with no ankles: no foot');
  ok(!footAt(step({ body: body().root, x: 5 }), false, out), 'a foot read farther than footReach from the body is not believed');
}
{
  // Through the real Footprints: the print goes under the foot, and the rule of before stands where there is no foot.
  const marks: PrintMark[] = [];
  const f = new Footprints();
  f.sink = (m) => void marks.push({ ...m });
  const slope = (out: FootGround): boolean => {
    out.nx = 0.2;
    out.ny = 0.9;
    out.nz = 0;
    out.owner = null;
    return true;
  };
  f.step(step({ key: 7, body: body().root, ground: slope }));
  const m = marks[0];
  const n = Math.hypot(0.2, 0.9);
  ok(!!m && m.left && close(m.x, -0.03, 1e-6) && close(m.fx, 1, 1e-6) && close(m.sx, -0, 1e-6) && close(m.sz, 1, 1e-6), 'a print under the landing foot, pointing along it, its side mirrored for the left foot');
  ok(close(m.y, -(0.2 / n) * -0.03 / (0.9 / n), 1e-9), 'and on the plane of the ground found under the body, out to the foot');
  ok(f.counts.onFoot === 1, 'counted as laid on the foot');
  // A body with no ankles, and the rule 'body': exactly the lines of before.
  for (const [what, b, rule] of [['no ankles', new THREE.Group(), 'foot'], ['rule body', body().root, 'body']] as const) {
    const was = PRINT_TUNE.rule;
    PRINT_TUNE.rule = rule;
    marks.length = 0;
    const g = new Footprints();
    g.sink = (mk) => void marks.push({ ...mk });
    const h = 0.7;
    g.step(step({ key: 3, body: b, heading: h, x: 4, z: 9 }));
    PRINT_TUNE.rule = was;
    const fw = { x: 0, z: 0 };
    const sd = { x: 0, z: 0 };
    facingOf(h, fw);
    sideOf(h, sd);
    const off = stanceOffset(PRINT_TUNE.stance, 1, true);
    const o = { x: 0, y: 0, z: 0 };
    slopeStep(sd.x, sd.z, 0, 1, 0, off, o);
    const p = marks[0];
    ok(!!p && p.x === 4 + o.x && p.z === 9 + o.z && p.fx === fw.x && p.fz === fw.z, `${what}: the rule of before, to the bit`);
  }
}

console.log(`\nsky bodies and footprints: ${checks} checks, 0 failed`);
