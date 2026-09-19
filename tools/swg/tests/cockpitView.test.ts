// The cockpit view: hovering and flying put the camera at the same point, Alt looks from the eye itself, and the
// hovering cockpit spends the mouse so nothing reaches the orbit.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ThirdPersonCamera } from '../../../src/core/camera.ts';
import type { Input } from '../../../src/core/input';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type FakeInput = { wheel: number; mouseDX: number; mouseDY: number; locked: boolean };
const makeInput = (): FakeInput => ({ wheel: 0, mouseDX: 0, mouseDY: 0, locked: true });
const asInput = (i: FakeInput) => i as unknown as Input;
const inFirstPerson = (): ThirdPersonCamera => {
  const cam = new ThirdPersonCamera(1);
  cam.distance = 0;
  cam.zoomTarget = 0;
  return cam;
};

let seed = 777;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const randQuat = () => {
  const u1 = rand(), u2 = rand() * 2 * Math.PI, u3 = rand() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return new THREE.Quaternion(a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3));
};
const quatNear = (a: THREE.Quaternion, b: THREE.Quaternion, eps: number) => Math.abs(Math.abs(a.dot(b)) - 1) < eps;

// Lift-off never moves the view: the hovering cockpit and the flight chase in first person put the camera at the same
// point (pos + q * eye) turned the same way.
{
  let samePos = true;
  let sameTurn = true;
  let bothFirst = true;
  for (let i = 0; i < 20; i++) {
    const group = new THREE.Group();
    group.position.set((rand() - 0.5) * 2000, rand() * 300, (rand() - 0.5) * 2000);
    group.quaternion.copy(randQuat());
    group.updateMatrixWorld(true);
    const eye = new THREE.Vector3((rand() - 0.5) * 4, rand() * 5, (rand() - 0.5) * 10);
    const a = inFirstPerson();
    a.cockpit(asInput(makeInput()), 1 / 60, group.localToWorld(eye.clone()), group.quaternion, 0);
    const b = inFirstPerson();
    b.chase(asInput(makeInput()), 1 / 60, group.position, group.quaternion, 0, 10, eye);
    if (a.camera.position.distanceTo(b.camera.position) > 1e-9 * Math.max(1, group.position.length())) samePos = false;
    if (!quatNear(a.camera.quaternion, b.camera.quaternion, 1e-9)) sameTurn = false;
    if (!a.firstPerson || !b.firstPerson) bothFirst = false;
  }
  ok(samePos, 'lift-off: the cockpit and the flight chase put the camera at the same point for twenty hull poses');
  ok(sameTurn, 'and turn it the same way');
  ok(bothFirst, 'and both stay in first person');
}

// The chase in the cockpit is level, so the orbit it hands back to starts from the nose.
{
  const cam = inFirstPerson();
  cam.chase(asInput(makeInput()), 1 / 60, new THREE.Vector3(), new THREE.Quaternion(), 0.4, 10, new THREE.Vector3(0, 1, 2));
  ok(cam.pitch === 0 && Math.abs(cam.yaw - (0.4 + Math.PI)) < 1e-12, 'the chase in the cockpit leaves the orbit level behind the nose');
  const out = new ThirdPersonCamera(1);
  out.chase(asInput(makeInput()), 1 / 60, new THREE.Vector3(), new THREE.Quaternion(), 0.4, 10, null);
  ok(out.pitch === 0.32, 'wheeled out it keeps the chase\'s tilt');
}

// Alt does not move the eye: with eyeAhead 0 the camera is exactly at the eye; by default 0.12 ahead along the view.
{
  const eye = new THREE.Vector3(3, 7, -2);
  const under = eye.clone().add(new THREE.Vector3(0, -1.5, 0));
  const cam = inFirstPerson();
  cam.yaw = 2.1;
  cam.pitch = 0.3;
  cam.update(asInput(makeInput()), under, null, 1 / 60, eye.clone(), 1, 1.5, 0);
  ok(cam.firstPerson && cam.camera.position.distanceTo(eye) < 1e-12, 'Alt from the cockpit: the camera sits exactly at the eye');
  const old = inFirstPerson();
  old.yaw = 2.1;
  old.pitch = 0.3;
  old.update(asInput(makeInput()), under, null, 1 / 60, eye.clone(), 1, 1.5);
  old.camera.updateMatrixWorld(true);
  const look = old.camera.getWorldDirection(new THREE.Vector3());
  const ahead = old.camera.position.clone().sub(eye);
  ok(Math.abs(ahead.length() - 0.12) < 1e-9 && ahead.normalize().dot(look) > 1 - 1e-9, 'everyone else keeps today\'s 0.12 ahead of the eyes along the view');
}

// The cockpit spends the mouse, keeps the orbit level behind the nose, and with zoom off leaves the wheel alone.
{
  const cam = inFirstPerson();
  const input = makeInput();
  input.mouseDX = 40;
  input.mouseDY = -25;
  cam.cockpit(asInput(input), 1 / 60, new THREE.Vector3(1, 2, 3), new THREE.Quaternion(), 1.3);
  ok(input.mouseDX === 0 && input.mouseDY === 0, 'the cockpit spends the mouse');
  ok(Math.abs(cam.yaw - (1.3 + Math.PI)) < 1e-12 && cam.pitch === 0, 'the orbit\'s yaw is the heading + PI and its pitch level');
  const wheeled = makeInput();
  wheeled.wheel = 1;
  const before = cam.distance;
  cam.cockpit(asInput(wheeled), 1 / 60, new THREE.Vector3(1, 2, 3), new THREE.Quaternion(), 1.3, false);
  ok(wheeled.wheel === 1 && cam.distance === before, 'with zoom off a wheel notch is left in the input and the distance is unchanged');
  cam.cockpit(asInput(wheeled), 1 / 60, new THREE.Vector3(1, 2, 3), new THREE.Quaternion(), 1.3);
  ok(wheeled.wheel === 0 && cam.zoomTarget > 0, 'with zoom on the notch takes the view out');
}

// Wheeling out of the hovering cockpit: the caller's rule (placeCamera) keeps the eye only while cockpit() leaves the
// view in first person; on the frame it crosses out, the same frame is drawn from the orbit, never from the eye with
// the head shown again.
{
  const eye = new THREE.Vector3(4, 9, -3);
  const under = eye.clone().add(new THREE.Vector3(0, -1.5, 0));
  const hull = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
  const cam = inFirstPerson();
  /** placeCamera's cockpit branch and its fall-through, on one frame: 'eye' or 'orbit'. */
  const frame = (input: FakeInput): 'eye' | 'orbit' => {
    cam.cockpit(asInput(input), 1 / 60, eye, hull, 0.7);
    if (cam.firstPerson) return 'eye';
    cam.update(asInput(input), under, null, 1 / 60, eye, 1, 1.5);
    return 'orbit';
  };
  const notch = makeInput();
  notch.wheel = 1;
  const views: string[] = [frame(notch)];
  let atEyeWhileFirst = cam.camera.position.distanceTo(eye) < 1e-12 || views[0] === 'orbit';
  while (views[views.length - 1] === 'eye' && views.length < 120) {
    views.push(frame(makeInput()));
    if (views[views.length - 1] === 'eye' && cam.camera.position.distanceTo(eye) >= 1e-12) atEyeWhileFirst = false;
  }
  ok(atEyeWhileFirst && views.length > 1 && views[views.length - 1] === 'orbit', 'a wheel notch keeps the eye for the frames still in first person, then goes out');
  ok(!cam.firstPerson && cam.camera.position.distanceTo(eye) > 0.3, 'the frame the view leaves first person is drawn from the orbit, not from the eye');
}

console.log(`${checks} checks passed`);
