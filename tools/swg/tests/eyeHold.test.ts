// First person on foot: the view is held this side of whatever stands between the body's axis and its eyes. A clip
// that leans carries the eyes out of the body's capsule, so pressed to a wall the view stood through the wall's face.
// Run through the camera's own update, against a wall that is a plane and a recording blocker.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ThirdPersonCamera, type CameraBlocker } from '../../../src/core/camera.ts';
import type { Input } from '../../../src/core/input';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type FakeInput = { wheel: number; mouseDX: number; mouseDY: number; locked: boolean };
const makeInput = (): Input => ({ wheel: 0, mouseDX: 0, mouseDY: 0, locked: true }) as FakeInput as unknown as Input;
const inFirstPerson = (yaw: number, pitch = 0): ThirdPersonCamera => {
  const cam = new ThirdPersonCamera(1);
  cam.distance = 0;
  cam.zoomTarget = 0;
  cam.yaw = yaw;
  cam.pitch = pitch;
  return cam;
};
/** The view's forward for an orbit yaw and pitch: the camera stands at the eyes plus 0.12 along it. */
const forward = (yaw: number, pitch = 0) => new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));

/** A wall: the plane through `at` whose normal `n` faces the body. Answers a segment's first crossing, as the physics does. */
const wall = (at: THREE.Vector3, n: THREE.Vector3, calls: { from: THREE.Vector3; to: THREE.Vector3 }[] = []): CameraBlocker => (from, to) => {
  calls.push({ from: from.clone(), to: to.clone() });
  const a = from.clone().sub(at).dot(n);
  const b = to.clone().sub(at).dot(n);
  if (a <= 0 || b > 0) return null;
  return (a / (a - b)) * from.distanceTo(to);
};

const feet = new THREE.Vector3(40, 12, -7);
const CLEAR = 0.1;

// 1. Nothing in the way: the view is exactly where it always was, the eyes plus 0.12 along the view.
{
  const yaw = 0.7;
  const eyes = feet.clone().add(new THREE.Vector3(0, 1.62, 0)).addScaledVector(forward(yaw), 0.45);
  const plain = inFirstPerson(yaw);
  plain.update(makeInput(), feet, null, 1 / 60, eyes.clone());
  const calls: { from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  const held = inFirstPerson(yaw);
  held.update(makeInput(), feet, wall(feet.clone().addScaledVector(forward(yaw), 5), forward(yaw).negate(), calls), 1 / 60, eyes.clone());
  ok(held.firstPerson && plain.firstPerson, 'both views are first person');
  ok(Object.is(held.camera.position.x, plain.camera.position.x) && Object.is(held.camera.position.y, plain.camera.position.y) && Object.is(held.camera.position.z, plain.camera.position.z), 'with the wall five metres off the view stands where it stood with no blocker, to the bit');
  ok(held.camera.quaternion.equals(plain.camera.quaternion), 'and looks the same way');
  ok(calls.length === 1, 'one question is asked a frame');
  const axis = feet.clone().add(new THREE.Vector3(0, 1.62, 0));
  ok(calls[0].from.distanceTo(axis) < 1e-9, "the question starts on the body's axis at the eyes' own height");
  const reach = plain.camera.position.clone().sub(axis);
  ok(Math.abs(calls[0].to.distanceTo(axis) - (reach.length() + CLEAR)) < 1e-9 && calls[0].to.clone().sub(axis).normalize().distanceTo(reach.clone().normalize()) < 1e-9, 'and ends the clear past the view along the same line');
}

// 2. Pressed to a wall with the eyes carried out of the capsule: the view stands the clear short of the wall's face.
for (const lead of [0.25, 0.37, 0.45, 0.58]) {
  const yaw = -1.9;
  const f = forward(yaw);
  // The capsule's face is 0.35 from the axis and the controller stands it 0.07 off the wall.
  const face = feet.clone().addScaledVector(f, 0.42);
  const eyes = feet.clone().add(new THREE.Vector3(0, 1.58, 0)).addScaledVector(f, lead);
  const cam = inFirstPerson(yaw);
  cam.update(makeInput(), feet, wall(face, f.clone().negate()), 1 / 60, eyes.clone());
  const toFace = face.clone().sub(cam.camera.position).dot(f);
  const free = lead + 0.12;
  if (free + CLEAR <= 0.42) ok(Math.abs(toFace - (0.42 - free)) < 1e-9, `eyes ${lead} m ahead: the view is clear of the wall and is left alone (${toFace.toFixed(3)} m from the face)`);
  else ok(Math.abs(toFace - CLEAR) < 1e-9, `eyes ${lead} m ahead (the view would stand ${Math.abs(free - 0.42).toFixed(2)} m ${free > 0.42 ? 'through' : 'short of'} the face): held ${toFace.toFixed(3)} m this side of it`);
  ok(Math.abs(cam.camera.position.y - eyes.y) < 1e-9, 'at the eyes\' own height');
  const look = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.camera.quaternion);
  ok(look.distanceTo(f) < 1e-9, 'still looking along the view');
}

// 3. A wall met at a slant, looking down: the view is pulled back along the line from the axis to itself.
{
  const yaw = 0.3, pitch = 0.5;
  const f = forward(yaw, pitch);
  const n = new THREE.Vector3(-Math.sin(yaw + 0.6), 0, -Math.cos(yaw + 0.6)).negate();
  const face = feet.clone().addScaledVector(n, -0.4);
  const eyes = feet.clone().add(new THREE.Vector3(0, 1.5, 0)).addScaledVector(forward(yaw), 0.55);
  const free = inFirstPerson(yaw, pitch);
  free.update(makeInput(), feet, null, 1 / 60, eyes.clone());
  const cam = inFirstPerson(yaw, pitch);
  cam.update(makeInput(), feet, wall(face, n), 1 / 60, eyes.clone());
  const axis = feet.clone().add(new THREE.Vector3(0, eyes.y - feet.y, 0));
  const line = free.camera.position.clone().sub(axis).normalize();
  const mine = cam.camera.position.clone().sub(axis);
  ok(free.camera.position.clone().sub(face).dot(n) < 0, 'unheld, the slanted view stands through the wall');
  ok(cam.camera.position.clone().sub(face).dot(n) > 0, 'held, it stands this side of it');
  ok(mine.clone().normalize().distanceTo(line) < 1e-9, 'on the line from the axis to where it would have stood');
  const d = -axis.clone().sub(face).dot(n) / line.dot(n);
  ok(Math.abs(mine.length() - (d - CLEAR)) < 1e-9, 'the clear short of the crossing along that line');
  ok(new THREE.Vector3(0, 0, -1).applyQuaternion(cam.camera.quaternion).distanceTo(f) < 1e-9, 'looking along the view as before');
}

// 4. A wall nearer than the clear: the view goes no further back than the axis.
{
  const yaw = 1.1;
  const f = forward(yaw);
  const eyes = feet.clone().add(new THREE.Vector3(0, 1.6, 0)).addScaledVector(f, 0.5);
  const cam = inFirstPerson(yaw);
  cam.update(makeInput(), feet, wall(feet.clone().addScaledVector(f, 0.04), f.clone().negate()), 1 / 60, eyes.clone());
  const axis = feet.clone().add(new THREE.Vector3(0, 1.6, 0));
  ok(cam.camera.position.distanceTo(axis) < 1e-9, 'a wall 4 cm from the axis leaves the view on the axis, never behind it');
}

// 5. A cockpit's eye (no reach ahead) and a view with no eyes are never asked about.
{
  const calls: { from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  const eye = new THREE.Vector3(3, 7, -2);
  const under = eye.clone().add(new THREE.Vector3(0, -1.5, 0));
  const cam = inFirstPerson(2.1, 0.3);
  cam.update(makeInput(), under, wall(under, new THREE.Vector3(0, 0, 1), calls), 1 / 60, eye.clone(), 1, 1.5, 0);
  ok(calls.length === 0 && cam.camera.position.distanceTo(eye) < 1e-12, "a cockpit's eye is exactly the eye and asks nothing");
  const none = inFirstPerson(2.1, 0.3);
  none.update(makeInput(), under, wall(under, new THREE.Vector3(0, 0, 1), calls), 1 / 60, null);
  ok(calls.length === 0, 'a first-person view with no eyes handed over asks nothing');
}

// 6. Aboard (a frame of the hull's): the axis is the hull's up, not the world's.
{
  const calls: { from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  const cam = inFirstPerson(0.4);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.9);
  cam.setFrame(q);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const eyes = feet.clone().addScaledVector(up, 1.6).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(q), 0.5);
  cam.update(makeInput(), feet, wall(feet.clone().add(new THREE.Vector3(0, 0, -50)), new THREE.Vector3(0, 0, 1), calls), 1 / 60, eyes.clone());
  ok(calls.length === 1 && calls[0].from.distanceTo(feet.clone().addScaledVector(up, 1.6)) < 1e-9, "aboard, the question starts on the body's axis along the hull's own up");
}

// 7. The game hands the on-foot view its blocker and its eyes, and the cockpit views none.
{
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  const onFoot = main.split('this.cam.update(input, player.worldPos, blocked, dt, eyes, player.grapple.camScaleNow, player.eyeHeight);').length - 1;
  ok(onFoot === 2, 'both on-foot views hand the camera the blocker and the eyes with the default reach ahead');
  const cam = readFileSync(new URL('../../../src/core/camera.ts', import.meta.url), 'utf8');
  ok(cam.includes('if (blocked && eyes && eyeAhead > 0) this.holdEye(target, eyes, blocked);'), "the hold is asked only of a figure's own eyes");
  ok(/const FIRST_PERSON_CLEAR = 0\.1;/.test(cam), 'the clear is the one this test reads');
}

console.log(`\n${checks} checks passed`);
