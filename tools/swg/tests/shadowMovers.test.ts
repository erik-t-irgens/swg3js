// The fast movers the sun's cascade holds listen to (the performance pass's sixth wave, src/world/shadowCadence.ts): the
// three walks the world, the stood shuttles and the other players run (`listVehicleMovers`, `listShuttleMover`,
// `listPeerMover`), over stand-ins of the shapes the game keeps -- vehicles, a stood shuttle whose body joint is posed
// along a path frame by frame, peers -- list exactly what moves faster than `fastMover` (a shuttle on its pad or not
// shown, nothing; a peer's figure swinging at 35 m/s, itself; a hull whose pose is written for it, by how far it went),
// with places and speeds from their kept fields; and through three's real `CSM` and the real `ShadowHold`, a cascade held
// while a listed mover reaches its band is drawn as `mover`, and one whose band no mover reaches stays held: the player's
// own speeder at 40 m/s under the camera holds the middle and far maps by age.
//
// Synthetic: stand-ins and the game's camera numbers, nothing read from the game's files.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { SHADOW_PASS_TUNE, ShadowHold, ShadowMovers, listPeerMover, listShuttleMover, listVehicleMovers } from '../../../src/world/shadowCadence.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const out = new ShadowMovers();
const frame = (dt: number): void => {
  out.dt[0] = dt;
  out.begin();
};

// ---- Vehicles. ----
{
  const mk = (x: number, speed: number, visible = true, disposed = false, holding = false) => ({ group: { position: new THREE.Vector3(x, 1, 0), visible }, speed, radius: 2, disposed, holding });
  const fast = mk(10, 40);
  const reverse = mk(20, -30);
  const slow = mk(30, 10);
  const hidden = mk(40, 60, false);
  const gone = mk(50, 60, true, true);
  const held = mk(60, 0, true, false, true);
  const list = [fast, reverse, slow, hidden, gone, held];
  const last = new WeakMap<object, Float64Array>();
  frame(1 / 60);
  listVehicleMovers(out, list, last);
  const kinds = () => Array.from({ length: out.n }, (_, j) => `${out.kind[j]}@${out.x[j]}:${out.speed[j].toFixed(0)}`);
  ok(out.n === 2 && out.x[0] === 10 && out.speed[0] === 40 && out.x[1] === 20 && out.speed[1] === 30, `by their own speed: the 40 m/s hull and the one reversing at 30 listed, the slow, the hidden and the gone not (${kinds().join(' ')})`);
  // A hull whose pose is written for it every frame (a hold: no speed of its own) moved a metre in a sixtieth: 60 m/s.
  held.group.position.x += 1;
  frame(1 / 60);
  listVehicleMovers(out, list, last);
  ok(out.n === 3 && out.kind[2] === 'vehicle' && Math.abs(out.speed[2] - 60) < 1e-6 && out.r[2] === 2, `a hull whose pose is written for it is listed by how far it went (${kinds().join(' ')})`);
  frame(1 / 60);
  listVehicleMovers(out, list, last);
  ok(out.n === 2, 'and not once it stands');
}

// ---- A hull the physics moves, at every frame rate: timed in the physics' own steps, never in frames. ----
// The game's order a frame: the hulls copy their bodies' places (the step count written then, `stepVehicles`), the
// physics steps whole sixtieths out of its accumulator (`Physics.step`), then the movers are listed. A hull with no speed
// of its own moving at 10 m/s, and one at 25: at 144, 120, 100, 60 and 30 frames a second, once its first step has been
// seen the place-given speed is the true one on every frame, so the slow one is never listed past the 20 m/s line and the
// fast one always is, whatever the frame rate.
{
  const FIXED = 1 / 60;
  const verdicts: string[] = [];
  let allExact = true;
  let sameEverywhere = true;
  for (const hz of [144, 120, 100, 60, 30]) {
    const dt = 1 / hz;
    const body = [new THREE.Vector3(0, 1, -150), new THREE.Vector3(0, 1, -150)];
    const speeds = [10, 25];
    const hulls = speeds.map((_, k) => ({ group: { position: body[k].clone(), visible: true }, speed: 0, radius: 2, disposed: false, holding: false }));
    const last = new WeakMap<object, Float64Array>();
    let acc = 0;
    let steps = 0;
    let listedSlow = 0;
    let listedFast = 0;
    let measured = 0;
    let worst = 0;
    for (let f = 0; f < hz * 5; f++) {
      // The hulls copy their bodies' places, with the step count they stand at.
      for (let k = 0; k < 2; k++) hulls[k].group.position.copy(body[k]);
      out.steps[0] = steps;
      // The physics' own step: whole sixtieths out of the accumulator.
      acc += dt;
      while (acc >= FIXED - 1e-12) {
        acc -= FIXED;
        steps++;
        for (let k = 0; k < 2; k++) body[k].z -= speeds[k] * FIXED;
      }
      frame(dt);
      listVehicleMovers(out, hulls, last);
      // After a second, every frame's place-given speed is read off the record the walk keeps.
      if (f < hz) continue;
      for (let k = 0; k < 2; k++) {
        const rec = last.get(hulls[k])!;
        worst = Math.max(worst, Math.abs(rec[5] - speeds[k]));
        measured++;
      }
      for (let j = 0; j < out.n; j++) {
        if (out.x[j] !== 0) continue;
        if (Math.abs(out.speed[j] - 10) < 1) listedSlow++;
        else listedFast++;
      }
    }
    const frames = hz * 4;
    if (worst > 1e-9) allExact = false;
    if (listedSlow !== 0 || listedFast !== frames) sameEverywhere = false;
    verdicts.push(`${hz} Hz: worst ${worst.toExponential(1)} m/s off, the 10 m/s hull listed on ${listedSlow} frames and the 25 m/s one on ${listedFast} of ${frames}`);
    void measured;
  }
  ok(allExact, `a hull the physics moves reads its own speed exactly at every frame rate once its first step is seen (${verdicts.join('; ')})`);
  ok(sameEverywhere, 'so the 20 m/s line lists it the same at 144, 120, 100, 60 and 30 frames a second: the slow one never, the fast one on every frame');
}

// ---- A stood shuttle: its body joint posed along a path, frame by frame. ----
{
  const root = new THREE.Group();
  const joint = new THREE.Object3D();
  root.add(joint);
  root.position.set(100, 0, 200);
  const s = { shown: true, role: 'land', body: joint, radius: 20, moverAt: new Float64Array(3), moverKnown: false };
  const step = (y: number): void => {
    joint.position.set(0, y, 0);
    frame(1 / 60);
    listShuttleMover(out, s);
  };
  step(200);
  ok(out.n === 0 && s.moverKnown, 'its first frame in flight only learns where it is');
  step(199);
  ok(out.n === 1 && out.kind[0] === 'shuttle' && Math.abs(out.speed[0] - 60) < 1e-6 && out.x[0] === 100 && out.y[0] === 199 && out.z[0] === 200 && out.r[0] === 40, `descending a metre a sixtieth (60 m/s): listed at its joint's place in the world, twice its piece's half-diagonal across`);
  step(198.8);
  ok(out.n === 0, 'slowed to 12 m/s: not listed');
  s.role = 'ground';
  step(0);
  ok(out.n === 0 && !s.moverKnown, 'on its pad: nothing, and its last place forgotten');
  s.role = 'lift';
  s.shown = false;
  step(50);
  ok(out.n === 0 && !s.moverKnown, 'not shown: nothing');
}

// ---- Peers. ----
{
  const peer = (visible: boolean, vel: number, ride: { reckoned: boolean; sent: number; glide: number } | null) => ({
    group: { visible, position: new THREE.Vector3(5, 2, 5) },
    vel: new THREE.Vector3(vel, 0, 0),
    vehicle: ride ? { obj: Object.assign(new THREE.Object3D(), {}), reckoned: ride.reckoned, sentVel: new THREE.Vector3(0, 0, ride.sent), vel: new THREE.Vector3(0, 0, ride.glide), size: { radius: 3 } } : null,
  });
  frame(1 / 60);
  listPeerMover(out, peer(true, 35, null));
  ok(out.n === 1 && out.kind[0] === 'figure' && out.speed[0] === 35 && out.r[0] === 1, 'a peer swinging on a rope at 35 m/s: their figure, a metre across');
  frame(1 / 60);
  listPeerMover(out, peer(true, 0, { reckoned: true, sent: 40, glide: 5 }));
  ok(out.n === 1 && out.kind[0] === 'ride' && out.speed[0] === 40 && out.r[0] === 3, 'a reckoned ride by the velocity its game sent, its picture\'s radius');
  frame(1 / 60);
  listPeerMover(out, peer(true, 0, { reckoned: false, sent: 40, glide: 5 }));
  ok(out.n === 0, 'a glided ride by the relay\'s, here too slow');
  frame(1 / 60);
  listPeerMover(out, peer(false, 50, { reckoned: true, sent: 50, glide: 50 }));
  ok(out.n === 0, 'a peer not shown: nothing');
}

// ---- What a listed mover does to the holds, through three's real CSM and the real ShadowHold. ----
{
  const camera = new THREE.PerspectiveCamera(60, 1600 / 900, 0.05, 9000);
  const csm = new CSM({ camera, parent: new THREE.Scene(), cascades: 3, maxFar: 320, mode: 'practical', shadowMapSize: 2048, lightDirection: new THREE.Vector3(0.3, -1, 0.2).normalize(), lightIntensity: 2, lightMargin: 150, lightNear: 1, lightFar: 470 });
  csm.fade = true;
  csm.updateFrustums();
  for (const l of csm.lights) {
    l.shadow.camera.near = 1;
    l.shadow.camera.far = 470;
    l.shadow.camera.updateProjectionMatrix();
    l.shadow.map = {} as THREE.WebGLRenderTarget;
  }
  csm.lightDirection.copy(new THREE.Vector3(0.83, 0.51, -0.21).normalize()).negate();
  camera.position.set(0, 2.5, 6);
  camera.rotation.set(-0.1, 0, 0, 'YXZ');
  camera.updateMatrixWorld();
  const hold = new ShadowHold();
  const lights = csm.lights;
  const decide = (now: number): string => {
    csm.update();
    hold.decide(lights, csm, camera, now, out);
    for (const l of lights) if (l.shadow.autoUpdate) l.shadow.needsUpdate = false;
    hold.drawn(lights, true, false);
    return hold.reason.slice(0, 3).join(' ');
  };
  SHADOW_PASS_TUNE.maxAgeMs.splice(0, SHADOW_PASS_TUNE.maxAgeMs.length, 0, 1e6, 1e6);
  frame(1 / 60);
  decide(0);
  // The player's own speeder at 40 m/s right under the camera, its ground under it.
  frame(1 / 60);
  const j = out.take();
  out.x[j] = 0;
  out.y[j] = 1;
  out.z[j] = 0;
  out.r[j] = 2;
  out.ground[j] = 0;
  out.speed[j] = 40;
  const own = decide(10);
  ok(own === 'age held held' && out.reached[j] === 0, `the speeder the player rides at 40 m/s: the middle and far maps held by age (${own})`);
  // A ship 150 m ahead and its ground: its shadow falls in the far band alone.
  frame(1 / 60);
  const k = out.take();
  out.x[k] = 0;
  out.y[k] = 2;
  out.z[k] = -150;
  out.r[k] = 3;
  out.ground[k] = 0;
  out.speed[k] = 40;
  const ahead = decide(20);
  ok(ahead === 'age held mover' && out.reached[k] === 4, `a fast ship 150 m ahead: the far map drawn as a mover, the middle still held (${ahead})`);
  frame(1 / 60);
  const back = decide(30);
  ok(back === 'age held held', `once it is no longer listed the far map is held again (${back})`);
  SHADOW_PASS_TUNE.maxAgeMs.splice(0, SHADOW_PASS_TUNE.maxAgeMs.length, 0, 13, 41);
}

console.log(`\n${checks} checks passed`);
