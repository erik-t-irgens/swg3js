// Turning a limb's bones onto a two-bone solve's answer (src/anim/twoBone.ts): the feet's placement now
// (src/player/footIk.ts) and the hands' bracing next (wave 4). Every turn here is worked out in one frame the caller
// chooses (the world's, or a ship's rooms' physics frame), from the bones' world turns in that frame: a bone's local turn
// is its parent's world turn, inverted, times its own world turn, so a turn given in that frame becomes the parent's
// inverse, the turn, the parent's turn and the bone's old local turn, in that order (frame independent).
//
// Nothing here makes an object: every scratch is kept, and the caller's records are written in place.

import * as THREE from 'three';

const tq = new THREE.Quaternion();

/** Turn a bone by `delta`, a turn given in the frame its parent's world turn `parentW` is in. */
export function turnBone(bone: THREE.Object3D, delta: THREE.Quaternion, parentW: THREE.Quaternion): void {
  tq.copy(parentW).invert().multiply(delta).multiply(parentW);
  bone.quaternion.premultiply(tq);
}

/** Set a bone's turn so its world turn (in the frame `parentW` is in) is `world`. */
export function setBoneWorld(bone: THREE.Object3D, world: THREE.Quaternion, parentW: THREE.Quaternion): void {
  bone.quaternion.copy(parentW).invert().multiply(world);
}

/** The two directions a turn is asked between, in a kept record (numbers handed across a call are made). */
export class TurnAsk {
  fx = 0.5;
  fy = 0.5;
  fz = 0.5;
  tx = 0.5;
  ty = 0.5;
  tz = 0.5;
}
const ASK = new TurnAsk();
const QA = new Float64Array(4);

/** The shortest turn taking direction `f` to direction `t` (neither need be unit), into `out`: the tests' and the console's form. */
export function turnBetween(out: THREE.Quaternion, fx: number, fy: number, fz: number, tx: number, ty: number, tz: number): THREE.Quaternion {
  ASK.fx = fx;
  ASK.fy = fy;
  ASK.fz = fz;
  ASK.tx = tx;
  ASK.ty = ty;
  ASK.tz = tz;
  return turnBetweenIn(out, ASK);
}

/** The shortest turn taking direction `a.f` to direction `a.t` (neither need be unit), into `out`. Identity for a direction of no length. */
export function turnBetweenIn(out: THREE.Quaternion, a: TurnAsk): THREE.Quaternion {
  const fx = a.fx;
  const fy = a.fy;
  const fz = a.fz;
  const tx = a.tx;
  const ty = a.ty;
  const tz = a.tz;
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (!(fl > 1e-12) || !(tl > 1e-12)) return out.set(0, 0, 0, 1);
  const ax = fx / fl;
  const ay = fy / fl;
  const az = fz / fl;
  const bx = tx / tl;
  const by = ty / tl;
  const bz = tz / tl;
  // three's own `setFromUnitVectors`, written out so no vector is made.
  let r = ax * bx + ay * by + az * bz + 1;
  let x: number;
  let y: number;
  let z: number;
  if (r < 1e-8) {
    r = 0;
    if (Math.abs(ax) > Math.abs(az)) {
      x = -ay;
      y = ax;
      z = 0;
    } else {
      x = 0;
      y = -az;
      z = ay;
    }
  } else {
    x = ay * bz - az * by;
    y = az * bx - ax * bz;
    z = ax * by - ay * bx;
  }
  // Unit, then into `out` through a kept array (three's `set` and `normalize` take and hand back numbers across a call).
  const l = Math.sqrt(x * x + y * y + z * z + r * r);
  QA[0] = x / l;
  QA[1] = y / l;
  QA[2] = z / l;
  QA[3] = r / l;
  return out.fromArray(QA);
}
